import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { t } from '@/i18n/uz';
import { db } from '@/mocks/db';
import { MOCK_DEMO_PASSWORD } from '@/mocks/handlers/auth.constants';
import { mockRequest } from '@/mocks';
import { PAGE, renderApp } from '@/test/render-app';
import type { SaleDto, SalesListResponse } from '@/shared/types/api';

function as(login: string) {
  const s = db();
  s.currentUserId = s.users.find((u) => u.login === login)!.id;
  return s;
}

describe('Sotuvlar tarixi (Phase 10, OWN-04/05/06)', () => {
  it('sotuvchi: faqat o‘z sotuvlari; foyda ustuni, foyda yig‘masi va user filtri yo‘q', async () => {
    renderApp('/sales?tab=history', { loggedOut: true });
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText(t.auth.login, {}, PAGE), 'aziz');
    await user.type(
      screen.getByLabelText(t.auth.password, { selector: 'input' }),
      MOCK_DEMO_PASSWORD,
    );
    await user.click(screen.getByRole('button', { name: t.auth.submit }));
    const table = await screen.findByRole('table', {}, PAGE);
    await waitFor(() => expect(within(table).getAllByRole('row').length).toBeGreaterThan(1), PAGE);
    expect(screen.queryByRole('columnheader', { name: t.sales.history.col.profit })).toBeNull();
    expect(screen.queryByText(t.sales.history.summaryProfit)).toBeNull();
    expect(screen.queryByRole('combobox', { name: t.sales.history.allUsers })).toBeNull();
  });
});

describe('mock API backend bilan bir xil', () => {
  it('sotuvchi: ro‘yxat faqat o‘ziniki (`userId` chetlab o‘tolmaydi), begona sotuv 404, tannarx yo‘q', async () => {
    renderApp('/sales', { loggedOut: true });
    const s = as('aziz');
    const me = s.currentUserId;
    const foreign = s.sales.find((x) => x.userId !== me)!;
    const list = await mockRequest<SalesListResponse>('/sales', {
      query: { pageSize: 100, userId: foreign.userId },
    });
    expect(list.data.every((x) => x.user.id === me)).toBe(true);
    expect(list.summary).not.toHaveProperty('totalCost');
    for (const sale of list.data) expect(sale).not.toHaveProperty('grossProfit');
    await expect(mockRequest(`/sales/${foreign.id}`)).rejects.toMatchObject({ status: 404 });
  });

  it('ism bilan kelgan mijoz — har doim yangi (D-17); kalit UUID bo‘lishi shart', async () => {
    renderApp('/sales');
    const s = as('admin');
    const w = s.warehouses.find((x) => x.status === 'ACTIVE')!;
    const p = s.products.find(
      (x) =>
        x.status === 'ACTIVE' && !x.allowDecimal && Number(s.stock[`${w.id}|${x.id}`] ?? 0) >= 2,
    )!;
    const before = s.customers.length;
    const body = {
      warehouseId: w.id,
      customer: { name: 'Bir xil', phone: '+998935550101' },
      items: [{ productId: p.id, quantity: '1' }],
    };
    for (let i = 0; i < 2; i++) {
      const sale = await mockRequest<SaleDto>('/sales', {
        method: 'POST',
        body,
        headers: { 'Idempotency-Key': crypto.randomUUID() },
      });
      expect(sale.customer.name).toBe('Bir xil');
    }
    expect(db().customers.length).toBe(before + 2);
    await expect(
      mockRequest('/sales', { method: 'POST', body, headers: { 'Idempotency-Key': 'abc' } }),
    ).rejects.toMatchObject({ status: 400 });
  });
});
