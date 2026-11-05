import {
  VALIDATION_MESSAGES_UZ,
  buildCreditInstallments,
  centsToMoney,
  computeCreditSchedule,
  creditAmountDueOn,
  creditCreateSchema,
  creditPaymentSchema,
  moneyToCents,
} from '@divine/shared';
import type {
  CreditDetailDto,
  CreditDto,
  CreditReminderDto,
  CreditsListResponse,
} from '@divine/shared';
import { recordAudit } from '../audit';
import { db } from '../db';
import { mockToday, nowIso } from '../lib/clock';
import { fail, includesText, notFound, paginate, route, validate } from '../lib/http';
import { mockUuid } from '../lib/random';
import { addDays } from '../lib/time';
import { currentCan, userRef } from '../mappers';
import type { CreditRow, MockState } from '../state';
import { creditNumber, creditPaid } from '../credits';

// Backend shartnomasi (D-24): sxema va jadval hisobi shared'dan; hamma narsa faqat `credits.manage`.

function requireManage() {
  if (!currentCan(db(), 'credits.manage')) fail(403, 'FORBIDDEN');
}

const scheduleOf = (c: CreditRow) =>
  computeCreditSchedule(c.installments, creditPaid(c), mockToday());

function toDto(s: MockState, c: CreditRow): CreditDto {
  const schedule = scheduleOf(c);
  return {
    id: c.id,
    number: creditNumber(c),
    debtorName: c.debtorName,
    debtorPhone: c.debtorPhone,
    amount: c.amount,
    paidAmount: schedule.paidAmount,
    remainingAmount: schedule.remainingAmount,
    takenAt: c.takenAt,
    installmentsCount: c.installments.length,
    status: schedule.status,
    next: schedule.next,
    note: c.note,
    createdBy: userRef(s, c.createdBy),
  };
}

function toDetail(s: MockState, c: CreditRow): CreditDetailDto {
  return {
    ...toDto(s, c),
    schedule: scheduleOf(c).rows,
    payments: [...c.payments]
      .sort((a, b) => `${b.date}${b.createdAt}`.localeCompare(`${a.date}${a.createdAt}`))
      .map((p) => ({ ...p, createdBy: userRef(s, p.createdBy) })),
  };
}

route('GET', '/credits', ({ query }): CreditsListResponse => {
  requireManage();
  const s = db();
  const matched = s.credits
    .filter((c) => includesText([c.debtorName, c.debtorPhone, creditNumber(c)], query.search))
    .filter((c) => !query.status || scheduleOf(c).status === query.status);
  const [field = 'next', direction = 'asc'] = (query.sort ?? 'next:asc').split(':');
  const key = (c: CreditRow): string | number => {
    if (field === 'takenAt') return c.takenAt;
    if (field === 'remainingAmount') return Number(moneyToCents(scheduleOf(c).remainingAmount));
    return scheduleOf(c).next?.dueDate ?? '9999-12-31';
  };
  const sorted = [...matched].sort((a, b) => {
    const [x, y] = [key(a), key(b)];
    return (x < y ? -1 : x > y ? 1 : 0) * (direction === 'asc' ? 1 : -1);
  });
  const page = paginate(sorted, query);
  const open = matched.filter((c) => scheduleOf(c).status !== 'PAID');
  return {
    data: page.data.map((c) => toDto(s, c)),
    meta: page.meta,
    summary: {
      remainingAmount: centsToMoney(
        open.reduce((sum, c) => sum + moneyToCents(scheduleOf(c).remainingAmount), 0n),
      ),
      activeCount: open.length,
      overdueCount: open.filter((c) => scheduleOf(c).status === 'OVERDUE').length,
    },
  };
});

route('GET', '/credits/reminders', (): CreditReminderDto[] => {
  requireManage();
  const tomorrow = addDays(mockToday(), 1);
  return db().credits.flatMap((c) => {
    const amount = creditAmountDueOn(scheduleOf(c), tomorrow);
    if (!amount) return [];
    return [
      {
        creditId: c.id,
        number: creditNumber(c),
        debtorName: c.debtorName,
        debtorPhone: c.debtorPhone,
        dueDate: tomorrow,
        amount,
      },
    ];
  });
});

route('GET', '/credits/:id', ({ params }) => {
  requireManage();
  const s = db();
  return toDetail(s, s.credits.find((c) => c.id === params.id) ?? notFound());
});

route('POST', '/credits', ({ body }) => {
  requireManage();
  const input = validate(creditCreateSchema, body);
  const s = db();
  s.counters.credit += 1;
  const row: CreditRow = {
    id: mockUuid(),
    number: s.counters.credit,
    debtorName: input.debtorName,
    debtorPhone: input.debtorPhone,
    amount: centsToMoney(moneyToCents(input.amount)),
    takenAt: new Date(input.takenAt).toISOString(),
    note: input.note ?? null,
    installments: buildCreditInstallments(input),
    payments: [],
    createdBy: s.currentUserId,
    createdAt: nowIso(),
  };
  s.credits.push(row);
  recordAudit({
    action: 'CREDIT_CREATED',
    entityType: 'CREDIT',
    entityId: row.id,
    metadata: {
      amount: input.amount,
      installments: input.installments,
      intervalDays: input.intervalDays,
      firstDueDate: input.firstDueDate,
    },
  });
  return toDetail(s, row);
});

route('POST', '/credits/:id/payments', ({ params, body }) => {
  requireManage();
  const input = validate(creditPaymentSchema, body);
  if (input.date > mockToday()) {
    fail(400, 'VALIDATION_ERROR', [
      { field: 'date', message: VALIDATION_MESSAGES_UZ.creditPaymentFuture },
    ]);
  }
  const s = db();
  const c = s.credits.find((x) => x.id === params.id) ?? notFound();
  const { remainingAmount } = scheduleOf(c);
  if (moneyToCents(input.amount) > moneyToCents(remainingAmount)) {
    fail(422, 'CREDIT_OVERPAID', [{ field: 'amount', message: `Qolgan qarz: ${remainingAmount}` }]);
  }
  const payment = {
    id: mockUuid(),
    date: input.date,
    amount: centsToMoney(moneyToCents(input.amount)),
    note: input.note ?? null,
    createdBy: s.currentUserId,
    createdAt: nowIso(),
  };
  c.payments.push(payment);
  recordAudit({
    action: 'CREDIT_PAYMENT_ADDED',
    entityType: 'CREDIT',
    entityId: c.id,
    metadata: { paymentId: payment.id, amount: input.amount, date: input.date },
  });
  return toDetail(s, c);
});
