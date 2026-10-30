import { describe, expect, it } from 'vitest';
import { t } from '@/i18n/uz';
import { describeMetadata, formatValue, keyLabel } from './metadata';

const norm = (text: string | undefined) => text?.replace(/\s+/g, ' ');

describe('audit metadata ko‘rinishi (Phase 13: umumiy kalit/qiymat)', () => {
  it('o‘zgarishlar "oldin → keyin", pul va miqdor formatlanadi, ID nomga aylanadi', () => {
    const lines = describeMetadata(
      {
        name: 'Non',
        changes: {
          salePrice: { from: '1000.00', to: '1200' },
          groupId: { from: 'g1', to: 'g2' },
          status: { from: 'ACTIVE', to: 'INACTIVE' },
        },
      },
      {
        group: new Map([
          ['g1', 'Oziq-ovqat'],
          ['g2', 'Ichimlik'],
        ]),
      },
    );
    expect(lines[0]).toEqual({ key: 'name', label: t.audit.keys.name, value: 'Non' });
    const [price, group, status] = lines[1]!.children!;
    expect(lines[1]!.label).toBe(t.audit.keys.changes);
    expect(norm(price!.change!.from)).toBe('1 000 so‘m');
    expect(norm(price!.change!.to)).toBe('1 200 so‘m');
    expect(group!.change).toEqual({ from: 'Oziq-ovqat', to: 'Ichimlik' });
    expect(status!.change).toEqual({ from: t.status.ACTIVE, to: t.status.INACTIVE });
  });

  it('kod qiymatlari, mantiqiy, bo‘sh, ro‘yxat va noma’lum kalitlar', () => {
    expect(formatValue('reason', 'INVALID_CREDENTIALS')).toBe(t.audit.values.INVALID_CREDENTIALS);
    expect(formatValue('role', 'USER')).toBe(t.roles.USER);
    expect(formatValue('hasNote', true)).toBe(t.audit.yes);
    expect(formatValue('note', null)).toBe(t.common.notSet);
    expect(formatValue('fields', ['amount', 'note'])).toBe(
      `${t.audit.keys.amount}, ${t.audit.keys.note}`,
    );
    expect(
      formatValue('warehouseIds', ['w1', 'w2'], { warehouse: new Map([['w1', 'Markaziy']]) }),
    ).toBe('Markaziy, w2');
    expect(formatValue('itemsCount', 1200)).toMatch(/^1\s200$/);
    expect(keyLabel('yangiKalit')).toBe('yangiKalit');
  });

  it('ichma-ich obyekt (kirim qatorlari) — bolalar qatorlari', () => {
    const [items] = describeMetadata({
      items: { replaced: true, from: { itemsCount: 1 }, to: { itemsCount: 2 } },
    });
    expect(items!.children!.map((c) => c.key)).toEqual(['replaced', 'from', 'to']);
    expect(items!.children![1]!.children![0]).toMatchObject({
      label: t.audit.keys.itemsCount,
      value: '1',
    });
  });
});
