import { lineTotal, normalizeNumberInput, sumMoney, sumQty } from '@/shared/lib/decimal';

export interface IncomingLineInput {
  quantity: string;
  costPrice: string;
}

/**
 * Kirim jami miqdori va summasi (TZ §7, BR-11): SUM(quantity), SUM(quantity × costPrice).
 * Hali to'liq kiritilmagan yoki noto'g'ri qiymatlar 0 deb olinadi — jami "sakramaydi".
 * Bu faqat UX uchun: server totallarni o'zi qayta hisoblaydi (REQ-065).
 */
export function computeIncomingTotals(lines: readonly IncomingLineInput[]) {
  const quantities: string[] = [];
  const amounts: string[] = [];
  for (const line of lines) {
    const quantity = normalizeNumberInput(line.quantity) ?? '0';
    quantities.push(quantity);
    amounts.push(lineTotal(quantity, normalizeNumberInput(line.costPrice) ?? '0'));
  }
  return {
    totalQuantity: sumQty(quantities),
    totalAmount: sumMoney(amounts),
    positions: lines.length,
  };
}
