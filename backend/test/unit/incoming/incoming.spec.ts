import { describe, expect, it } from 'vitest';
import type {
  IncomingItemRow,
  IncomingRow,
} from '../../../src/modules/incoming/incoming.repository.js';
import { toIncomingDto } from '../../../src/modules/incoming/incoming.service.js';

const row: IncomingRow = {
  id: 'd',
  number: 'K-000007',
  date: '2026-10-06',
  warehouseId: 'w',
  warehouseName: 'Asosiy',
  notes: null,
  status: 'CONFIRMED',
  itemsCount: 1,
  totalQuantity: '2.000',
  totalAmount: '3669134.00',
  createdBy: { id: 'u', login: 'admin', fullName: null },
  confirmedBy: { id: 'u', login: 'admin', fullName: null },
  confirmedAt: new Date('2026-10-06T10:00:00.000Z'),
  cancelledBy: null,
  cancelledAt: null,
  createdAt: new Date('2026-10-06T09:00:00.000Z'),
  updatedAt: new Date('2026-10-06T10:00:00.000Z'),
};
const items: IncomingItemRow[] = [
  {
    id: 'i',
    productId: 'p',
    productName: 'Telefon',
    groupName: 'Smartfonlar',
    barcode: null,
    unit: 'DONA',
    quantity: '2.000',
    costPrice: '1834567.00',
    lineTotal: '3669134.00',
  },
];

describe('toIncomingDto (OWN-06)', () => {
  it('`products.read_cost` bo‘lmasa kelgan narxi, qator va hujjat summasi kaliti yo‘q', () => {
    const dto = toIncomingDto(row, items, false);
    expect(dto).not.toHaveProperty('totalAmount');
    expect(dto.items?.[0]).not.toHaveProperty('costPrice');
    expect(dto.items?.[0]).not.toHaveProperty('lineTotal');
    expect(JSON.stringify(dto)).not.toMatch(/1834567|3669134/);
    expect(dto).toMatchObject({ totalQuantity: '2.000', confirmedAt: '2026-10-06T10:00:00.000Z' });
  });

  it('ruxsat bo‘lsa — hammasi; ro‘yxat javobida qatorlar yo‘q', () => {
    expect(toIncomingDto(row, items, true)).toMatchObject({
      totalAmount: '3669134.00',
      items: [{ costPrice: '1834567.00', lineTotal: '3669134.00' }],
    });
    expect(toIncomingDto(row, undefined, true)).not.toHaveProperty('items');
  });
});
