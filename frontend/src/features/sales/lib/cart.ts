import type { ProductUnit } from '@divine/shared';
import { addQty, compareQty, lineTotal, sumMoney, sumQty } from '@/shared/lib/decimal';

// Savat mantig'i — sof funksiyalar (UI'dan alohida, testlanadi). Hisob decimal-safe.
// Yakuniy narx va qoldiq tekshiruvi baribir SERVERDA bo'ladi (BR-07, BR-15).

export interface CartLine {
  productId: string;
  name: string;
  unit: ProductUnit;
  allowDecimal: boolean;
  unitPrice: string;
  /** Tanlangan ombordagi mavjud qoldiq. */
  stock: string;
  quantity: string;
}

export type CartProduct = Omit<CartLine, 'quantity'>;

export interface AddResult {
  lines: CartLine[];
  /** Qoldiq yetmagani uchun miqdor cheklangan yoki qo'shilmadi. */
  limited: boolean;
}

export function addToCart(lines: CartLine[], product: CartProduct, quantity = '1'): AddResult {
  if (compareQty(product.stock, '0') <= 0) return { lines, limited: true };
  const existing = lines.find((l) => l.productId === product.productId);
  const wanted = addQty(existing?.quantity ?? '0', quantity);
  const limited = compareQty(wanted, product.stock) > 0;
  const next = limited ? product.stock : wanted;
  if (existing) {
    return {
      lines: lines.map((l) =>
        l.productId === product.productId ? { ...l, stock: product.stock, quantity: next } : l,
      ),
      limited,
    };
  }
  return { lines: [...lines, { ...product, quantity: next }], limited };
}

export function setLineQuantity(
  lines: CartLine[],
  productId: string,
  quantity: string,
): CartLine[] {
  return lines.map((l) => {
    if (l.productId !== productId) return l;
    const capped = compareQty(quantity, l.stock) > 0 ? l.stock : quantity;
    return { ...l, quantity: capped };
  });
}

export function removeLine(lines: CartLine[], productId: string): CartLine[] {
  return lines.filter((l) => l.productId !== productId);
}

export function lineSubtotal(line: CartLine): string {
  return lineTotal(line.quantity, line.unitPrice);
}

export function cartTotals(lines: CartLine[]) {
  return {
    positions: lines.length,
    totalQuantity: sumQty(lines.map((l) => l.quantity)),
    totalAmount: sumMoney(lines.map(lineSubtotal)),
  };
}
