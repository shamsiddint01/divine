import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { t } from '@/i18n/uz';
import { db } from '@/mocks/db';
import { mockRequest } from '@/mocks';
import { PAGE, renderApp } from '@/test/render-app';
import type { CustomerDto, CustomerPurchasesResponse, Paginated } from '@/shared/types/api';

function as(login: string) {
  const s = db();
  s.currentUserId = s.users.find((u) => u.login === login)!.id;
  return s;
}

describe('Mijozlar sahifasi (Phase 9)', () => {
  it('admin: mijoz qo‘shadi (telefon normallashtiriladi), keyin qidiruv bilan topadi', async () => {
    renderApp('/customers');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: t.customers.add }, PAGE));
    const dialog = await screen.findByRole('dialog');
    await user.type(
      within(dialog).getByLabelText(new RegExp(t.customers.form.name)),
      'Sinov Mijozbek',
    );
    await user.type(
      within(dialog).getByLabelText(new RegExp(t.customers.form.phone)),
      '93 555 11 22',
    );
    await user.type(within(dialog).getByLabelText(new RegExp(t.customers.form.notes)), 'Ulgurji');
    await user.click(within(dialog).getByRole('button', { name: t.common.create }));
    await waitFor(
      () =>
        expect(db().customers.find((c) => c.name === 'Sinov Mijozbek')).toMatchObject({
          phone: '+998935551122',
          notes: 'Ulgurji',
        }),
      PAGE,
    );
    await user.type(screen.getByPlaceholderText(t.customers.searchPlaceholder), '5551122');
    expect(await screen.findByText('Sinov Mijozbek', {}, PAGE)).toBeInTheDocument();
  });
});

describe('mock API backend bilan bir xil (OWN-07, A-23)', () => {
  it('sotuvchi: qidiruvda faqat id, name, phone; yig‘ma saralash 400; detal/tarix/tahrirlash 403; izoh 403', async () => {
    renderApp('/sales', { loggedOut: true });
    as('aziz');
    const list = await mockRequest<Paginated<CustomerDto>>('/customers', {
      query: { pageSize: 5, sort: 'lastPurchaseAt:desc' },
    });
    expect(list.data.length).toBeGreaterThan(0);
    for (const c of list.data) expect(Object.keys(c).sort()).toEqual(['id', 'name', 'phone']);
    await expect(
      mockRequest('/customers', { query: { sort: 'totalSpent:desc' } }),
    ).rejects.toMatchObject({ status: 400 });
    const id = list.data[0]!.id;
    for (const path of [`/customers/${id}`, `/customers/${id}/purchases`]) {
      await expect(mockRequest(path)).rejects.toMatchObject({ status: 403 });
    }
    await expect(
      mockRequest(`/customers/${id}`, { method: 'PATCH', body: { name: 'Buzish' } }),
    ).rejects.toMatchObject({ status: 403 });
    const created = await mockRequest<CustomerDto>('/customers', {
      method: 'POST',
      body: { name: 'Kassa mijozi', phone: '' },
    });
    expect(created).toEqual({ id: created.id, name: 'Kassa mijozi', phone: null });
    await expect(
      mockRequest('/customers', { method: 'POST', body: { name: 'Izohli', notes: 'x' } }),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('admin: takroriy ism/telefon ruxsat; telefonni null bilan tozalash; xarid tarixida yig‘ma', async () => {
    renderApp('/customers');
    as('admin');
    const body = { name: 'Oila Bir', phone: '+998935550000' };
    const a = await mockRequest<CustomerDto>('/customers', { method: 'POST', body });
    const b = await mockRequest<CustomerDto>('/customers', { method: 'POST', body });
    expect(a.id).not.toBe(b.id);
    const cleared = await mockRequest<CustomerDto>(`/customers/${a.id}`, {
      method: 'PATCH',
      body: { phone: null },
    });
    expect(cleared.phone).toBeNull();
    await expect(
      mockRequest('/customers', { method: 'POST', body: { name: 'X', totalSpent: '1' } }),
    ).rejects.toMatchObject({ status: 400 });

    const buyer = db().sales[0]!.customerId;
    const history = await mockRequest<CustomerPurchasesResponse>(`/customers/${buyer}/purchases`);
    expect(history.data.length).toBeGreaterThan(0);
    expect(history.summary.purchaseCount).toBe(
      db().sales.filter((s) => s.customerId === buyer).length,
    );
    expect(history.data[0]).toHaveProperty('totalCost');
  });
});
