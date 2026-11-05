import { describe, expect, it } from 'vitest';
import {
  type CartProduct,
  addToCart,
  cartTotals,
  removeLine,
  repriceCart,
  setLineQuantity,
} from './cart';

const phone: CartProduct = {
  productId: 'p1',
  name: 'Telefon',
  unit: 'DONA',
  allowDecimal: false,
  unitPrice: '2190000.00',
  retailPrice: '2190000.00',
  wholesalePrice: '2000000.00',
  stock: '3.000',
};
const rice: CartProduct = {
  productId: 'p2',
  name: 'Guruch',
  unit: 'KG',
  allowDecimal: true,
  unitPrice: '28000.00',
  retailPrice: '28000.00',
  wholesalePrice: null,
  stock: '10.000',
};

describe('savat (POS)', () => {
  it('mahsulot qo‘shadi va takror qo‘shilganda miqdorni oshiradi', () => {
    let { lines } = addToCart([], phone);
    ({ lines } = addToCart(lines, phone));
    expect(lines).toHaveLength(1);
    expect(lines[0]?.quantity).toBe('2.000');
  });

  it('qoldiqdan oshirib bo‘lmaydi (UX darajasida BR-07)', () => {
    const r = addToCart([], phone, '5');
    expect(r.limited).toBe(true);
    expect(r.lines[0]?.quantity).toBe('3.000');
    expect(setLineQuantity(r.lines, 'p1', '10')[0]?.quantity).toBe('3.000');
  });

  it('qoldig‘i 0 bo‘lgan mahsulot qo‘shilmaydi', () => {
    const r = addToCart([], { ...phone, stock: '0.000' });
    expect(r.lines).toHaveLength(0);
    expect(r.limited).toBe(true);
  });

  it('jami summani decimal-safe hisoblaydi (kasr miqdor bilan)', () => {
    let { lines } = addToCart([], phone, '2');
    ({ lines } = addToCart(lines, rice, '1.5'));
    const totals = cartTotals(lines);
    expect(totals.positions).toBe(2);
    expect(totals.totalQuantity).toBe('3.500');
    expect(totals.totalAmount).toBe('4422000.00'); // 2×2 190 000 + 1,5×28 000
    expect(cartTotals(removeLine(lines, 'p1')).totalAmount).toBe('42000.00');
  });
});

describe('savat — qator miqdori (Phase 15)', () => {
  it('miqdor qoldiq bilan cheklanadi; boshqa qatorlar o‘zgarmaydi; o‘chirish', () => {
    const { lines } = addToCart(addToCart([], phone).lines, rice, '2');
    const capped = setLineQuantity(lines, 'p2', '25');
    expect(capped.find((l) => l.productId === 'p2')?.quantity).toBe('10.000');
    expect(capped.find((l) => l.productId === 'p1')).toBe(lines[0]);
    expect(setLineQuantity(lines, 'p2', '1.5').find((l) => l.productId === 'p2')?.quantity).toBe(
      '1.5',
    );
    expect(removeLine(lines, 'p1').map((l) => l.productId)).toEqual(['p2']);
  });

  it('takror qo‘shishda qoldiq yangilanadi va undan oshmaydi', () => {
    const first = addToCart([], phone, '2').lines;
    const result = addToCart(first, { ...phone, stock: '2.000' });
    expect(result.limited).toBe(true);
    expect(result.lines[0]).toMatchObject({ quantity: '2.000', stock: '2.000' });
  });
});

describe('repriceCart — dona/optom almashganda (D-25)', () => {
  const lines = addToCart(addToCart([], phone).lines, rice).lines;

  it('optomga: narx o‘zgaradi, optom narxi yo‘q qator chiqariladi', () => {
    const result = repriceCart(lines, 'WHOLESALE');
    expect(result.lines.map((l) => [l.productId, l.unitPrice])).toEqual([['p1', '2000000.00']]);
    expect(result.removed.map((l) => l.name)).toEqual(['Guruch']);
  });

  it('donaga qaytsa: dona narxi tiklanadi, miqdor saqlanadi', () => {
    const wholesale = repriceCart(lines, 'WHOLESALE').lines;
    const result = repriceCart(wholesale, 'RETAIL');
    expect(result.lines[0]).toMatchObject({ unitPrice: '2190000.00', quantity: '1' });
    expect(result.removed).toEqual([]);
  });
});
