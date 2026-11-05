import { z } from 'zod';
import {
  CREDIT_INSTALLMENTS_MAX,
  CREDIT_INTERVAL_DAYS_MAX,
  CREDIT_MIN_AMOUNT,
} from '../constants/index.js';
import { VALIDATION_MESSAGES_UZ as M } from './messages.uz.js';
import { nullableDescriptionSchema } from './catalog.js';
import {
  customerNameSchema,
  dateOnlySchema,
  phoneSchema,
  positiveMoneySchema,
} from './primitives.js';

// Nasiya (D-24). Body sxemalari `strictObject`: noma'lum maydon → 400; jadval va qoldiqni faqat server
// hisoblaydi. Backend va frontend mock bir xil sxema va hisobdan foydalanadi.

const TASHKENT_OFFSET_MS = 5 * 60 * 60 * 1000;

/** Pul satri → tiyin (float'siz aniq hisob). */
export const moneyToCents = (value: string): bigint => {
  const [int = '0', frac = ''] = value.split('.');
  return BigInt(int) * 100n + BigInt(frac.padEnd(2, '0').slice(0, 2));
};

/** ISO vaqtning Toshkent sanasi (`YYYY-MM-DD`). */
export function tashkentDateOf(iso: string): string {
  return new Date(Date.parse(iso) + TASHKENT_OFFSET_MS).toISOString().slice(0, 10);
}

/** Nasiya summasi kamida `CREDIT_MIN_AMOUNT` so'm. */
export function isCreditAmountAllowed(amount: string): boolean {
  return moneyToCents(amount) >= moneyToCents(CREDIT_MIN_AMOUNT);
}

export const creditCreateSchema = z
  .strictObject({
    debtorName: customerNameSchema,
    debtorPhone: z
      .string({ error: M.creditPhoneRequired })
      .trim()
      .min(1, { error: M.creditPhoneRequired })
      .pipe(phoneSchema),
    amount: positiveMoneySchema.refine(isCreditAmountAllowed, { error: M.creditAmountMin }),
    /** Nasiya berilgan sana va vaqt. */
    takenAt: z.iso.datetime({ offset: true, error: M.invalidDate }),
    /** Birinchi (yoki yagona) to'lov sanasi. */
    firstDueDate: dateOnlySchema,
    /** Necha marta bo'lib to'lanadi (1 — bir yo'la). */
    installments: z
      .number({ error: M.creditInstallments })
      .int({ error: M.creditInstallments })
      .min(1, { error: M.creditInstallments })
      .max(CREDIT_INSTALLMENTS_MAX, { error: M.creditInstallments }),
    /** To'lovlar orasidagi kun (1 — har kuni). */
    intervalDays: z
      .number({ error: M.creditInterval })
      .int({ error: M.creditInterval })
      .min(1, { error: M.creditInterval })
      .max(CREDIT_INTERVAL_DAYS_MAX, { error: M.creditInterval })
      .default(1),
    note: nullableDescriptionSchema.optional(),
  })
  .refine((v) => v.firstDueDate >= tashkentDateOf(v.takenAt), {
    error: M.creditDueBeforeTaken,
    path: ['firstDueDate'],
  })
  // Har bir to'lov kamida 1 tiyin bo'lishi kerak.
  .refine((v) => moneyToCents(v.amount) >= BigInt(v.installments), {
    error: M.creditInstallments,
    path: ['installments'],
  });

export const creditPaymentSchema = z.strictObject({
  amount: positiveMoneySchema,
  /** To'lov sanasi (Toshkent kuni, bugundan keyin emas). */
  date: dateOnlySchema,
  note: nullableDescriptionSchema.optional(),
});

export type CreditCreateInput = z.infer<typeof creditCreateSchema>;
export type CreditPaymentInput = z.infer<typeof creditPaymentSchema>;

// ─── To'lov jadvali ─────────────────────────────────────────────────────────

export interface CreditInstallment {
  seq: number;
  dueDate: string;
  amount: string;
}

/**
 * PENDING — hali to'lanmagan; PARTIAL — qisman; PAID — yopilgan; CARRIED — muddati o'tdi, qoldig'i
 * keyingi to'lovga qo'shildi; OVERDUE — oxirgi to'lov muddati o'tgan, qoldiq bor.
 */
export type CreditRowState = 'PENDING' | 'PARTIAL' | 'PAID' | 'CARRIED' | 'OVERDUE';
export type CreditStatus = 'ACTIVE' | 'OVERDUE' | 'PAID';

export interface CreditScheduleRow extends CreditInstallment {
  /** Shu qatorga taqsimlangan to'lov. */
  paid: string;
  /** Shu qatorning o'z qoldig'i. */
  remaining: string;
  /** Shu sanada to'lanishi kerak: o'z qoldig'i + oldingi kunlardan o'tgan qoldiq. */
  toPay: string;
  state: CreditRowState;
}

export interface CreditSchedule {
  rows: CreditScheduleRow[];
  paidAmount: string;
  remainingAmount: string;
  status: CreditStatus;
  /** Eng yaqin to'lov (bugun yoki keyin; hammasi o'tgan bo'lsa — oxirgisi). Yopilgan nasiyada `null`. */
  next: { dueDate: string; amount: string } | null;
}

export const centsToMoney = (cents: bigint): string =>
  `${cents / 100n}.${String(cents % 100n).padStart(2, '0')}`;

/** `YYYY-MM-DD` + kun (UTC hisobida — sana vaqt mintaqasiga bog'liq emas). */
function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

/**
 * Teng bo'lish: 50 000 / 4 = 12 500. Butun so'mga yaxlitlanadi, qoldiq oxirgi to'lovga qo'shiladi
 * (100 000 / 3 = 33 333 + 33 333 + 33 334). Summa juda kichik bo'lsa, oldingi to'lovlar 0 bo'lmasligi
 * uchun tiyinda bo'linadi.
 */
export function buildCreditInstallments(input: {
  amount: string;
  firstDueDate: string;
  installments: number;
  intervalDays: number;
}): CreditInstallment[] {
  const total = moneyToCents(input.amount);
  const count = BigInt(input.installments);
  const whole = (total / count / 100n) * 100n;
  const base = whole > 0n ? whole : total / count;
  return Array.from({ length: input.installments }, (_, index) => ({
    seq: index + 1,
    dueDate: addDays(input.firstDueDate, index * input.intervalDays),
    amount: centsToMoney(index === input.installments - 1 ? total - base * (count - 1n) : base),
  }));
}

/**
 * Jadval va to'lovlar: to'langan summa qatorlarga tartib bilan taqsimlanadi. Shuning uchun ortiqcha
 * to'lov keyingi kundan ayriladi, yetmagani esa muddat o'tgach keyingi to'lovga qo'shiladi.
 */
export function computeCreditSchedule(
  installments: readonly CreditInstallment[],
  paidAmount: string,
  today: string,
): CreditSchedule {
  const paidTotal = moneyToCents(paidAmount);
  let left = paidTotal;
  let carry = 0n;
  let total = 0n;
  const rows = installments.map((row, index): CreditScheduleRow => {
    const amount = moneyToCents(row.amount);
    total += amount;
    const paid = left < amount ? left : amount;
    left -= paid;
    const remaining = amount - paid;
    const last = index === installments.length - 1;
    let toPay = 0n;
    let state: CreditRowState = 'PAID';
    if (remaining > 0n) {
      if (row.dueDate < today && !last) {
        carry += remaining;
        state = 'CARRIED';
      } else {
        toPay = remaining + carry;
        carry = 0n;
        state = row.dueDate < today ? 'OVERDUE' : paid > 0n ? 'PARTIAL' : 'PENDING';
      }
    }
    return {
      ...row,
      paid: centsToMoney(paid),
      remaining: centsToMoney(remaining),
      toPay: centsToMoney(toPay),
      state,
    };
  });
  const remainingAmount = total - paidTotal;
  const nextRow = rows.find((row) => moneyToCents(row.toPay) > 0n);
  const overdue = rows.some((row) => row.state === 'CARRIED' || row.state === 'OVERDUE');
  return {
    rows,
    paidAmount: centsToMoney(paidTotal),
    remainingAmount: centsToMoney(remainingAmount > 0n ? remainingAmount : 0n),
    status: remainingAmount <= 0n ? 'PAID' : overdue ? 'OVERDUE' : 'ACTIVE',
    next: nextRow ? { dueDate: nextRow.dueDate, amount: nextRow.toPay } : null,
  };
}

/**
 * Eslatma: `date` kuni to'lov bormi va shu kungacha jami qancha to'lanishi kerak (bugungi to'lanmagan
 * qoldiq ham kiradi). To'lov yo'q yoki yopilgan bo'lsa — `null`.
 */
export function creditAmountDueOn(schedule: CreditSchedule, date: string): string | null {
  const index = schedule.rows.findIndex((row) => row.dueDate === date);
  const target = schedule.rows[index];
  if (!target || moneyToCents(target.remaining) === 0n) return null;
  const sum = schedule.rows
    .slice(0, index + 1)
    .reduce((acc, row) => acc + moneyToCents(row.remaining), 0n);
  return centsToMoney(sum);
}
