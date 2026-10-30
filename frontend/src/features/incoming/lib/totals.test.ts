import { describe, expect, it } from 'vitest';
import { computeIncomingTotals } from './totals';

describe('kirim jami (BR-11, TZ §7)', () => {
  it('TZ misoli: 50 + 30 + 100 + 20 = 200', () => {
    const totals = computeIncomingTotals([
      { quantity: '50', costPrice: '1850000' },
      { quantity: '30', costPrice: '210000' },
      { quantity: '100', costPrice: '12000' },
      { quantity: '20', costPrice: '95000' },
    ]);
    expect(totals.totalQuantity).toBe('200.000');
    expect(totals.totalAmount).toBe('101900000.00'); // 92,5 + 6,3 + 1,2 + 1,9 mln
    expect(totals.positions).toBe(4);
  });

  it('miqdor o‘zgarsa jami qayta hisoblanadi', () => {
    const lines = [
      { quantity: '50', costPrice: '1' },
      { quantity: '30', costPrice: '1' },
    ];
    expect(computeIncomingTotals(lines).totalQuantity).toBe('80.000');
    lines[1] = { quantity: '45', costPrice: '1' };
    expect(computeIncomingTotals(lines).totalQuantity).toBe('95.000');
  });

  it('bo‘sh yoki noto‘g‘ri kiritilgan qiymat 0 deb olinadi; "1 250,5" formati qabul qilinadi', () => {
    const totals = computeIncomingTotals([
      { quantity: '', costPrice: '100' },
      { quantity: 'abc', costPrice: '100' },
      { quantity: '1 250,5', costPrice: '2' },
      { quantity: '3', costPrice: 'narx yo‘q' },
    ]);
    expect(totals.totalQuantity).toBe('1253.500');
    expect(totals.totalAmount).toBe('2501.00');
  });
});
