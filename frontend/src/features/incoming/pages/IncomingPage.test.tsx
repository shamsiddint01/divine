import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { t } from '@/i18n/uz';
import { db } from '@/mocks/db';
import { getStock } from '@/mocks/inventory';
import { mockRequest } from '@/mocks';
import { PAGE, renderApp } from '@/test/render-app';
import type { IncomingDto, Paginated, SaleDto } from '@/shared/types/api';

function as(login: string) {
  const s = db();
  s.currentUserId = s.users.find((u) => u.login === login)!.id;
  return s;
}

describe('Kirim: mock API backend bilan bir xil (API §9, Phase 8)', () => {
  it('admin: qoralama → tasdiqlash qoldiqni bir marta oshiradi; takroriy tasdiqlash 409; snapshot saqlanadi', async () => {
    renderApp('/incoming');
    expect(await screen.findByRole('link', { name: t.incoming.add }, PAGE)).toBeInTheDocument();
    const s = as('admin');
    const warehouse = s.warehouses.find((w) => w.status === 'ACTIVE')!;
    const product = s.products.find((p) => p.status === 'ACTIVE' && !p.allowDecimal)!;
    const before = getStock(s, warehouse.id, product.id);

    const doc = await mockRequest<IncomingDto>('/incoming', {
      method: 'POST',
      body: {
        date: '2026-10-06',
        warehouseId: warehouse.id,
        items: [{ productId: product.id, quantity: '4', costPrice: '1000.00' }],
      },
    });
    expect(doc).toMatchObject({ status: 'DRAFT', totalQuantity: '4.000', totalAmount: '4000.00' });
    expect(getStock(db(), warehouse.id, product.id)).toBe(before);

    const originalName = product.name;
    await mockRequest(`/incoming/${doc.id}/confirm`, { method: 'POST' });
    await expect(
      mockRequest(`/incoming/${doc.id}/confirm`, { method: 'POST' }),
    ).rejects.toMatchObject({ status: 409 });
    const after = db();
    expect(Number(getStock(after, warehouse.id, product.id))).toBe(Number(before) + 4);

    after.products.find((p) => p.id === product.id)!.name = 'Qayta nomlangan';
    const detail = await mockRequest<IncomingDto>(`/incoming/${doc.id}`);
    expect(detail.items?.[0]?.productName).toBe(originalName);
  });

  it('D-16: kirim mahsulot kartochkasidagi tannarxni o‘zgartirmaydi; sotuv foydasi kartochka tannarxidan', async () => {
    renderApp('/incoming');
    const s = as('admin');
    const warehouse = s.warehouses.find((w) => w.status === 'ACTIVE')!;
    const product = s.products.find((p) => p.status === 'ACTIVE' && !p.allowDecimal)!;
    const cardCost = product.costPrice;
    const doc = await mockRequest<IncomingDto>('/incoming', {
      method: 'POST',
      body: {
        date: '2026-10-06',
        warehouseId: warehouse.id,
        items: [{ productId: product.id, quantity: '3', costPrice: '1.00' }],
      },
    });
    await mockRequest(`/incoming/${doc.id}/confirm`, { method: 'POST' });
    expect(db().products.find((p) => p.id === product.id)!.costPrice).toBe(cardCost);

    const sale = await mockRequest<SaleDto>('/sales', {
      method: 'POST',
      headers: { 'Idempotency-Key': crypto.randomUUID() },
      body: {
        warehouseId: warehouse.id,
        customer: { name: 'Sinov mijoz', phone: null },
        items: [{ productId: product.id, quantity: '1' }],
      },
    });
    expect(sale.items?.[0]?.unitCost).toBe(cardCost);
    expect(sale.totalCost).toBe(cardCost);
  });

  it('client totallari (`totalAmount`, `lineTotal`) → 400; takroriy mahsulot → 400', async () => {
    renderApp('/incoming');
    const s = as('admin');
    const warehouseId = s.warehouses.find((w) => w.status === 'ACTIVE')!.id;
    const productId = s.products.find((p) => p.status === 'ACTIVE')!.id;
    const item = { productId, quantity: '1', costPrice: '10' };
    for (const body of [
      { date: '2026-10-06', warehouseId, items: [item], totalAmount: '1' },
      { date: '2026-10-06', warehouseId, items: [{ ...item, lineTotal: '1' }] },
      { date: '2026-10-06', warehouseId, items: [item, item] },
    ]) {
      await expect(mockRequest('/incoming', { method: 'POST', body })).rejects.toMatchObject({
        status: 400,
      });
    }
  });

  it('sotuvchi: ro‘yxat, yaratish va tasdiqlash → 403 (narx ma’lumoti qaytmaydi)', async () => {
    renderApp('/incoming', { loggedOut: true });
    const s = as('aziz');
    const own = s.users.find((u) => u.login === 'aziz')!.warehouseIds[0]!;
    const productId = s.products.find((p) => p.status === 'ACTIVE')!.id;
    const draft = s.incoming.find((d) => d.status === 'DRAFT')!;
    await expect(mockRequest<Paginated<IncomingDto>>('/incoming')).rejects.toMatchObject({
      status: 403,
    });
    await expect(
      mockRequest('/incoming', {
        method: 'POST',
        body: {
          date: '2026-10-06',
          warehouseId: own,
          items: [{ productId, quantity: '1', costPrice: '1' }],
        },
      }),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      mockRequest(`/incoming/${draft.id}/confirm`, { method: 'POST' }),
    ).rejects.toMatchObject({ status: 403 });
    expect(db().incoming.find((d) => d.id === draft.id)?.status).toBe('DRAFT');
  });
});
