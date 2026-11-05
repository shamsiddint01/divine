import { describe, expect, it } from 'vitest';
import type { CustomerRow } from '../../../src/modules/customers/customers.repository.js';
import { toCustomerDto } from '../../../src/modules/customers/customers.service.js';
import type { SaleRow } from '../../../src/modules/sales/sales.repository.js';
import { toSaleDto } from '../../../src/modules/sales/sales.service.js';

const customer: CustomerRow = {
  id: 'c',
  name: 'Aziz',
  phone: '+998901234567',
  notes: 'Ichki izoh',
  purchaseCount: 3,
  totalSpent: '450000.00',
  lastPurchaseAt: new Date('2026-10-20T10:00:00.000Z'),
  createdAt: new Date('2026-10-01T10:00:00.000Z'),
  updatedAt: new Date('2026-10-02T10:00:00.000Z'),
};

const sale: SaleRow = {
  id: 's',
  number: 'S-000001',
  soldAt: new Date('2026-10-20T10:00:00.000Z'),
  user: { id: 'u', login: 'aziz', fullName: null },
  warehouse: { id: 'w', name: 'Asosiy' },
  customer: { id: 'c', name: 'Aziz', phone: null },
  itemsCount: 1,
  totalQuantity: '1.000',
  totalAmount: '150000.00',
  totalCost: '90000.00',
  grossProfit: '60000.00',
  status: 'COMPLETED',
  priceType: 'RETAIL',
  credit: null,
  items: [
    {
      productId: 'p',
      productName: 'Kabel',
      barcode: null,
      unit: 'DONA',
      quantity: '1.000',
      unitPrice: '150000.00',
      lineTotal: '150000.00',
      unitCost: '90000.00',
      lineProfit: '60000.00',
    },
  ],
};

describe('mijoz serializerlari (OWN-07, OWN-06)', () => {
  it('`customers.read_history`siz — faqat id, name, phone', () => {
    expect(toCustomerDto(customer, false)).toEqual({
      id: 'c',
      name: 'Aziz',
      phone: '+998901234567',
    });
    expect(toCustomerDto(customer, true)).toMatchObject({
      notes: 'Ichki izoh',
      purchaseCount: 3,
      totalSpent: '450000.00',
      lastPurchaseAt: '2026-10-20T10:00:00.000Z',
    });
  });

  it('sotuv: `products.read_cost`siz tannarx va foyda kaliti yo‘q', () => {
    const dto = toSaleDto(sale, false);
    expect(dto).not.toHaveProperty('totalCost');
    expect(dto).not.toHaveProperty('grossProfit');
    expect(dto.items?.[0]).not.toHaveProperty('unitCost');
    expect(dto.items?.[0]).not.toHaveProperty('lineProfit');
    expect(JSON.stringify(dto)).not.toMatch(/90000|60000/);
    expect(toSaleDto(sale, true)).toMatchObject({ totalCost: '90000.00', grossProfit: '60000.00' });
  });
});
