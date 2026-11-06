import { Permission } from '@divine/shared';
import { describe, expect, it, vi } from 'vitest';
import type { AccessContext } from '../../../src/common/auth/access-context.js';
import type {
  IncomingDetailRow,
  ReportsRepository,
} from '../../../src/modules/reports/reports.repository.js';
import { ReportsService } from '../../../src/modules/reports/reports.service.js';

const row: IncomingDetailRow = {
  number: 'K-000020',
  date: '2026-11-05',
  warehouse: 'Asosiy',
  status: 'CONFIRMED',
  notes: null,
  createdBy: { id: 'u', login: 'aziz', fullName: null },
  totalQuantity: '2.000',
  totalAmount: '1000.00',
  items: [
    {
      productId: 'p',
      productName: 'Shapka',
      barcode: null,
      unit: 'DONA',
      quantity: '2.000',
      costPrice: '500.00',
      lineTotal: '1000.00',
    },
  ],
};

function service() {
  const incomingDetail = vi.fn(async () => row);
  return {
    incomingDetail,
    reports: new ReportsService({ incomingDetail } as unknown as ReportsRepository),
  };
}
const ctx = (permissions: string[]) =>
  ({ permissions: new Set(permissions) }) as unknown as AccessContext;

describe('kirim hisoboti tafsiloti (OWN-06)', () => {
  it('`products.read_cost` bor — narx va summa javobda', async () => {
    const { reports, incomingDetail } = service();
    const res = await reports.incomingDetail(ctx([Permission.PRODUCTS_READ_COST]), 'K-000020');
    expect(incomingDetail).toHaveBeenCalledWith(20n);
    expect(res).toEqual(row);
  });

  it('`products.read_cost` yo‘q — narx va summa kaliti umuman yo‘q', async () => {
    const res = await service().reports.incomingDetail(ctx([]), 'K-000020');
    expect(res).not.toHaveProperty('totalAmount');
    expect(res.items[0]).not.toHaveProperty('costPrice');
    expect(res.items[0]).not.toHaveProperty('lineTotal');
    expect(res.items[0]).toMatchObject({ productName: 'Shapka', quantity: '2.000' });
  });

  it('noto‘g‘ri raqam bazaga bormaydi', async () => {
    const { reports, incomingDetail } = service();
    await expect(reports.incomingDetail(ctx([]), 'abc')).rejects.toThrow();
    expect(incomingDetail).not.toHaveBeenCalled();
  });
});
