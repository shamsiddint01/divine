import { centsToMoney, moneyToCents } from '@divine/shared';
import type { CreditRow } from './state';

export const creditNumber = (c: CreditRow) => `N-${String(c.number).padStart(6, '0')}`;

export const creditPaid = (c: CreditRow) =>
  centsToMoney(c.payments.reduce((sum, p) => sum + moneyToCents(p.amount), 0n));
