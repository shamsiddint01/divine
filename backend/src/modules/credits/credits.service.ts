import { Injectable } from '@nestjs/common';
import {
  AuditAction,
  AuditEntityType,
  buildCreditInstallments,
  centsToMoney,
  computeCreditSchedule,
  creditAmountDueOn,
  type CreditCreateInput,
  type CreditDetailDto,
  type CreditDto,
  type CreditInstallment,
  type CreditPaymentInput,
  type CreditReminderDto,
  type CreditSchedule,
  type CreditsListResponse,
  type CreditStatus,
  ErrorCode,
  moneyToCents,
  type SortSpec,
  VALIDATION_MESSAGES_UZ,
} from '@divine/shared';
import type { AccessContext } from '../../common/auth/access-context.js';
import { AppError } from '../../common/errors/app-error.js';
import { toPaginated } from '../../common/query/prisma-query.js';
import { Clock } from '../../common/time/clock.js';
import { tashkentToday } from '../../common/time/tashkent-time.js';
import { TransactionRunner } from '../../infrastructure/prisma/transaction-runner.js';
import { AuditService, type RequestMeta } from '../audit/audit.service.js';
import { type CreditRow, CreditsRepository } from './credits.repository.js';

export type CreditSortField = 'next' | 'takenAt' | 'remainingAmount';

export interface ListCreditsQuery {
  page: number;
  pageSize: number;
  sort: SortSpec<CreditSortField>;
  search?: string;
  status?: CreditStatus;
}

const DAY_MS = 86_400_000;

function toCreditDto(
  row: CreditRow,
  installments: CreditInstallment[],
  schedule: CreditSchedule,
): CreditDto {
  return {
    id: row.id,
    number: row.number,
    debtorName: row.debtorName,
    debtorPhone: row.debtorPhone,
    amount: row.amount,
    paidAmount: schedule.paidAmount,
    remainingAmount: schedule.remainingAmount,
    takenAt: row.takenAt.toISOString(),
    installmentsCount: installments.length,
    status: schedule.status,
    next: schedule.next,
    note: row.note,
    createdBy: row.createdBy,
  };
}

/**
 * Nasiya (D-24). Jadval va qoldiq `@divine/shared` hisobidan: to'langan summa qatorlarga tartib bilan
 * taqsimlanadi — yetmagani keyingi to'lovga qo'shiladi, ortig'i keyingisidan ayriladi. Nasiyalar soni kichik
 * (do'kon doirasida), holat hisoblangan qiymat — shuning uchun filtr va tartib shu yerda.
 */
@Injectable()
export class CreditsService {
  constructor(
    private readonly repository: CreditsRepository,
    private readonly transactions: TransactionRunner,
    private readonly audit: AuditService,
    private readonly clock: Clock,
  ) {}

  private async withSchedules(search?: string) {
    const rows = await this.repository.list(search);
    const installments = await this.repository.installmentsOf(rows.map((row) => row.id));
    const today = tashkentToday(this.clock.now());
    return rows.map((row) => {
      const plan = installments.get(row.id) ?? [];
      return { row, plan, schedule: computeCreditSchedule(plan, row.paidAmount, today) };
    });
  }

  async list(query: ListCreditsQuery): Promise<CreditsListResponse> {
    const all = await this.withSchedules(query.search);
    const matched = all.filter((c) => !query.status || c.schedule.status === query.status);
    const direction = query.sort.direction === 'asc' ? 1 : -1;
    const key = (c: (typeof all)[number]): string | number => {
      if (query.sort.field === 'takenAt') return c.row.takenAt.getTime();
      if (query.sort.field === 'remainingAmount') {
        return Number(moneyToCents(c.schedule.remainingAmount));
      }
      // Yopilgan nasiyalar — oxirida.
      return c.schedule.next?.dueDate ?? '9999-12-31';
    };
    const sorted = [...matched].sort((a, b) => {
      const [x, y] = [key(a), key(b)];
      return (x < y ? -1 : x > y ? 1 : 0) * direction;
    });
    const start = (query.page - 1) * query.pageSize;
    const open = matched.filter((c) => c.schedule.status !== 'PAID');
    const remaining = open.reduce((sum, c) => sum + moneyToCents(c.schedule.remainingAmount), 0n);
    return {
      ...toPaginated(
        sorted
          .slice(start, start + query.pageSize)
          .map((c) => toCreditDto(c.row, c.plan, c.schedule)),
        matched.length,
        query,
      ),
      summary: {
        remainingAmount: centsToMoney(remaining),
        activeCount: open.length,
        overdueCount: open.filter((c) => c.schedule.status === 'OVERDUE').length,
      },
    };
  }

  /** Ertaga to'lovi borlar (to'lov kunidan bir kun oldin eslatma). */
  async reminders(): Promise<CreditReminderDto[]> {
    const tomorrow = tashkentToday(new Date(this.clock.now().getTime() + DAY_MS));
    const all = await this.withSchedules();
    return all.flatMap(({ row, schedule }) => {
      const amount = creditAmountDueOn(schedule, tomorrow);
      if (!amount) return [];
      return [
        {
          creditId: row.id,
          number: row.number,
          debtorName: row.debtorName,
          debtorPhone: row.debtorPhone,
          dueDate: tomorrow,
          amount,
        },
      ];
    });
  }

  async get(id: string): Promise<CreditDetailDto> {
    const row = (await this.repository.find(id)) ?? notFound();
    const plan = (await this.repository.installmentsOf([id])).get(id) ?? [];
    const schedule = computeCreditSchedule(plan, row.paidAmount, tashkentToday(this.clock.now()));
    const payments = await this.repository.payments(id);
    return {
      ...toCreditDto(row, plan, schedule),
      schedule: schedule.rows,
      payments: payments.map((p) => ({ ...p, createdAt: p.createdAt.toISOString() })),
    };
  }

  async create(
    ctx: AccessContext,
    input: CreditCreateInput,
    meta: RequestMeta,
  ): Promise<CreditDetailDto> {
    const installments = buildCreditInstallments(input);
    const id = await this.transactions.run(async (tx) => {
      const creditId = await this.repository.create(
        tx,
        {
          debtorName: input.debtorName,
          debtorPhone: input.debtorPhone,
          amount: input.amount,
          takenAt: new Date(input.takenAt),
          note: input.note ?? null,
          createdById: ctx.userId,
        },
        installments,
      );
      // Audit'da ism, telefon va izoh yozilmaydi (shaxsiy ma'lumot).
      await this.audit.record(
        {
          actorId: ctx.userId,
          action: AuditAction.CREDIT_CREATED,
          entityType: AuditEntityType.CREDIT,
          entityId: creditId,
          metadata: {
            amount: input.amount,
            installments: input.installments,
            intervalDays: input.intervalDays,
            firstDueDate: input.firstDueDate,
          },
          meta,
        },
        tx,
      );
      return creditId;
    });
    return this.get(id);
  }

  /** To'lov: qoldiqdan oshsa `422 CREDIT_OVERPAID`; kelajak sana — `400`; yopilgan nasiya ham shu xato. */
  async addPayment(
    ctx: AccessContext,
    id: string,
    input: CreditPaymentInput,
    meta: RequestMeta,
  ): Promise<CreditDetailDto> {
    const today = tashkentToday(this.clock.now());
    if (input.date > today) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, {
        details: [{ field: 'date', message: VALIDATION_MESSAGES_UZ.creditPaymentFuture }],
      });
    }
    await this.transactions.run(async (tx) => {
      if (!(await this.repository.lock(tx, id))) notFound();
      const row = (await this.repository.find(id, tx)) ?? notFound();
      const plan = (await this.repository.installmentsOf([id], tx)).get(id) ?? [];
      const { remainingAmount } = computeCreditSchedule(plan, row.paidAmount, today);
      if (moneyToCents(input.amount) > moneyToCents(remainingAmount)) {
        throw new AppError(ErrorCode.CREDIT_OVERPAID, {
          details: [{ field: 'amount', message: `Qolgan qarz: ${remainingAmount}` }],
        });
      }
      const paymentId = await this.repository.addPayment(tx, {
        creditId: id,
        date: input.date,
        amount: input.amount,
        note: input.note ?? null,
        createdById: ctx.userId,
      });
      await this.audit.record(
        {
          actorId: ctx.userId,
          action: AuditAction.CREDIT_PAYMENT_ADDED,
          entityType: AuditEntityType.CREDIT,
          entityId: id,
          metadata: { paymentId, amount: input.amount, date: input.date },
          meta,
        },
        tx,
      );
    });
    return this.get(id);
  }
}

function notFound(): never {
  throw new AppError(ErrorCode.NOT_FOUND);
}
