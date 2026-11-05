import {
  type SaleCreditInput,
  buildCreditInstallments,
  centsToMoney,
  moneyToCents,
} from '@divine/shared';
import { recordAudit } from './audit';
import { mockUuid } from './lib/random';
import type { CreditRow, MockState, SaleRow } from './state';

export const creditNumber = (c: CreditRow) => `N-${String(c.number).padStart(6, '0')}`;

export const creditPaid = (c: CreditRow) =>
  centsToMoney(c.payments.reduce((sum, p) => sum + moneyToCents(p.amount), 0n));

/** Backend `CreditsService.createForSale` aksi: qarz = sotuv jami − to'langan (D-26). */
export function createCreditForSale(state: MockState, sale: SaleRow, input: SaleCreditInput) {
  const amount = centsToMoney(moneyToCents(sale.totalAmount) - moneyToCents(input.paidAmount));
  state.counters.credit += 1;
  const row: CreditRow = {
    id: mockUuid(),
    number: state.counters.credit,
    debtorName: input.debtorName,
    debtorPhone: input.debtorPhone,
    amount,
    takenAt: sale.soldAt,
    note: input.note ?? null,
    saleId: sale.id,
    installments: buildCreditInstallments({ ...input, amount }),
    payments: [],
    createdBy: state.currentUserId,
    createdAt: sale.soldAt,
  };
  state.credits.push(row);
  recordAudit({
    action: 'CREDIT_CREATED',
    entityType: 'CREDIT',
    entityId: row.id,
    metadata: {
      amount,
      paidAmount: input.paidAmount,
      saleId: sale.id,
      installments: input.installments,
      intervalDays: input.intervalDays,
      firstDueDate: input.firstDueDate,
    },
  });
}
