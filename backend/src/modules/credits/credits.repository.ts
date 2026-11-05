import { Injectable } from '@nestjs/common';
import type { CreditInstallment, CreditSaleDto, ProductUnit, UserRefDto } from '@divine/shared';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import type { Tx } from '../../infrastructure/prisma/transaction-runner.js';
import { escapeLike } from '../product-groups/product-groups.repository.js';

export interface CreditRow {
  id: string;
  number: string;
  debtorName: string;
  debtorPhone: string;
  amount: string;
  paidAmount: string;
  takenAt: Date;
  note: string | null;
  createdBy: UserRefDto;
  saleId: string | null;
  saleNumber: string | null;
}

export interface CreditPaymentRow {
  id: string;
  date: string;
  amount: string;
  note: string | null;
  createdBy: UserRefDto;
  createdAt: Date;
}

type RawCredit = Omit<CreditRow, 'createdBy'> & {
  createdById: string;
  createdLogin: string;
  createdName: string | null;
};

type RawPayment = Omit<CreditPaymentRow, 'createdBy'> & {
  createdById: string;
  createdLogin: string;
  createdName: string | null;
};

const SELECT = Prisma.sql`
  SELECT c.id, 'N-' || lpad(c.number::text, 6, '0') AS number,
         c.debtor_name AS "debtorName", c.debtor_phone AS "debtorPhone",
         c.amount::text AS amount, c.taken_at AS "takenAt", c.note,
         coalesce((SELECT sum(p.amount) FROM credit_payments p WHERE p.credit_id = c.id), 0)::text
           AS "paidAmount",
         u.id AS "createdById", u.login AS "createdLogin", u.full_name AS "createdName",
         c.sale_id AS "saleId",
         CASE WHEN s.id IS NULL THEN NULL ELSE 'S-' || lpad(s.number::text, 6, '0') END AS "saleNumber"
    FROM credits c
    JOIN users u ON u.id = c.created_by
    LEFT JOIN sales s ON s.id = c.sale_id`;

const toCreditRow = ({ createdById, createdLogin, createdName, ...row }: RawCredit): CreditRow => ({
  ...row,
  createdBy: { id: createdById, login: createdLogin, fullName: createdName },
});

/** Nasiya — data access. Qoldiq saqlanmaydi: to'lovlar yig'indisi va jadvaldan hisoblanadi. */
@Injectable()
export class CreditsRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Ism, telefon yoki raqam (`N-000123`) bo'yicha. */
  async list(search: string | undefined): Promise<CreditRow[]> {
    const pattern = search ? `%${escapeLike(search)}%` : null;
    const digits = search ? /^(?:n-?)?0*(\d{1,18})$/i.exec(search)?.[1] : undefined;
    const where = pattern
      ? Prisma.sql`WHERE c.debtor_name ILIKE ${pattern} ESCAPE '\\'
          OR c.debtor_phone ILIKE ${pattern} ESCAPE '\\'
          ${digits ? Prisma.sql`OR c.number = ${BigInt(digits)}` : Prisma.empty}`
      : Prisma.empty;
    const rows = await this.prisma.$queryRaw<RawCredit[]>`${SELECT} ${where}`;
    return rows.map(toCreditRow);
  }

  async find(id: string, client: Tx | PrismaService = this.prisma): Promise<CreditRow | null> {
    const rows = await client.$queryRaw<RawCredit[]>`${SELECT} WHERE c.id = ${id}::uuid`;
    return rows[0] ? toCreditRow(rows[0]) : null;
  }

  /** Bir nechta nasiyaning jadvali bitta so'rovda (ro'yxat uchun). */
  async installmentsOf(
    ids: string[],
    client: Tx | PrismaService = this.prisma,
  ): Promise<Map<string, CreditInstallment[]>> {
    const rows = await client.$queryRaw<(CreditInstallment & { creditId: string })[]>`
      SELECT credit_id AS "creditId", seq, due_date::text AS "dueDate", amount::text AS amount
        FROM credit_installments WHERE credit_id = ANY(${ids}::uuid[]) ORDER BY credit_id, seq`;
    const map = new Map<string, CreditInstallment[]>();
    for (const { creditId, ...row } of rows) {
      map.set(creditId, [...(map.get(creditId) ?? []), row]);
    }
    return map;
  }

  async payments(id: string, client: Tx | PrismaService = this.prisma) {
    const rows = await client.$queryRaw<RawPayment[]>`
      SELECT p.id, p.payment_date::text AS date, p.amount::text AS amount, p.note,
             p.created_at AS "createdAt",
             u.id AS "createdById", u.login AS "createdLogin", u.full_name AS "createdName"
        FROM credit_payments p
        JOIN users u ON u.id = p.created_by
       WHERE p.credit_id = ${id}::uuid
       ORDER BY p.payment_date DESC, p.created_at DESC`;
    return rows.map(({ createdById, createdLogin, createdName, ...row }): CreditPaymentRow => ({
      ...row,
      createdBy: { id: createdById, login: createdLogin, fullName: createdName },
    }));
  }

  /** Nasiya sotuvi: sana, jami va mahsulotlar (narx va nomlar sotuv paytidagi snapshot). */
  async saleOf(
    saleId: string,
    creditAmount: string,
  ): Promise<CreditSaleDto | null> {
    const [sale] = await this.prisma.$queryRaw<
      { id: string; number: string; soldAt: Date; totalAmount: string; paidAmount: string }[]
    >`
      SELECT id, 'S-' || lpad(number::text, 6, '0') AS number, sold_at AS "soldAt",
             total_amount::text AS "totalAmount",
             (total_amount - ${creditAmount}::numeric)::text AS "paidAmount"
        FROM sales WHERE id = ${saleId}::uuid`;
    if (!sale) return null;
    const items = await this.prisma.$queryRaw<
      (Omit<CreditSaleDto['items'][number], 'unit'> & { unit: string })[]
    >`
      SELECT i.product_id AS "productId", i.product_name AS "productName", p.unit::text AS unit,
             i.quantity::text AS quantity, i.unit_price::text AS "unitPrice",
             i.line_total::text AS "lineTotal"
        FROM sale_items i JOIN products p ON p.id = i.product_id
       WHERE i.sale_id = ${saleId}::uuid ORDER BY i.id`;
    return {
      ...sale,
      soldAt: sale.soldAt.toISOString(),
      items: items.map((item) => ({ ...item, unit: item.unit as ProductUnit })),
    };
  }

  async create(
    tx: Tx,
    data: {
      debtorName: string;
      debtorPhone: string;
      amount: string;
      takenAt: Date;
      note: string | null;
      createdById: string;
      saleId?: string;
    },
    installments: CreditInstallment[],
  ): Promise<string> {
    const { id } = await tx.credit.create({ data, select: { id: true } });
    await tx.creditInstallment.createMany({
      data: installments.map((row) => ({
        creditId: id,
        seq: row.seq,
        dueDate: new Date(`${row.dueDate}T00:00:00Z`),
        amount: row.amount,
      })),
    });
    return id;
  }

  /** `FOR UPDATE`: parallel to'lovlar navbat bilan o'tadi — qoldiqdan oshib ketmaydi. */
  async lock(tx: Tx, id: string): Promise<boolean> {
    const rows = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM credits WHERE id = ${id}::uuid FOR UPDATE`;
    return rows.length > 0;
  }

  async addPayment(
    tx: Tx,
    data: {
      creditId: string;
      date: string;
      amount: string;
      note: string | null;
      createdById: string;
    },
  ): Promise<string> {
    const { date, ...rest } = data;
    const { id } = await tx.creditPayment.create({
      data: { ...rest, paymentDate: new Date(`${date}T00:00:00Z`) },
      select: { id: true },
    });
    await tx.credit.update({
      where: { id: data.creditId },
      data: { updatedAt: new Date() },
      select: { id: true },
    });
    return id;
  }
}
