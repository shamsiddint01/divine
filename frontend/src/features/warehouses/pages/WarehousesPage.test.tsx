import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { t } from '@/i18n/uz';
import { db } from '@/mocks/db';
import { mockRequest } from '@/mocks';
import { PAGE, renderApp } from '@/test/render-app';
import type { Paginated, WarehouseListItemDto } from '@/shared/types/api';

describe('Omborlar sahifasi (Phase 7)', () => {
  it('admin: qidiruv omborlarni filtrlaydi; nofaol qilish tasdiq so‘raydi, keyin qayta faollashtiriladi', async () => {
    renderApp('/warehouses');
    const user = userEvent.setup();
    const first = db().warehouses[0]!;
    expect(await screen.findByRole('link', { name: first.name }, PAGE)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: t.warehouses.add })).toBeInTheDocument();

    await user.type(screen.getByPlaceholderText(t.warehouses.searchPlaceholder), first.name);
    await waitFor(
      () =>
        expect(
          db()
            .warehouses.filter((w) => screen.queryByRole('link', { name: w.name }))
            .map((w) => w.id),
        ).toEqual([first.id]),
      // Qidiruv debounce + mock kechikishi; yuklangan mashinada 1 s (standart) yetmaydi.
      PAGE,
    );

    await user.click(screen.getByRole('button', { name: t.warehouses.deactivate }));
    const dialog = await screen.findByRole('alertdialog');
    expect(
      within(dialog).getByText(t.warehouses.deactivateDescription(first.name)),
    ).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: t.warehouses.deactivate }));
    await waitFor(() => expect(db().warehouses[0]!.status).toBe('INACTIVE'), PAGE);

    // Karta yangilanadi: endi "Faollashtirish" (tasdiqsiz — xavfsiz amal).
    await user.click(await screen.findByRole('button', { name: t.warehouses.activate }, PAGE));
    await waitFor(() => expect(db().warehouses[0]!.status).toBe('ACTIVE'), PAGE);
    expect(
      await screen.findByRole('button', { name: t.warehouses.deactivate }, PAGE),
    ).toBeInTheDocument();
  });
});

describe('Omborlar sahifasi — server-side pagination (Phase 14)', () => {
  it('ko‘p ombor bo‘lsa birinchi 12 tasi va sahifalash; keyingi sahifada qolganlari (yashirin kesilmaydi)', async () => {
    const { state } = renderApp('/warehouses');
    const template = state.warehouses[0]!;
    for (let i = 1; i <= 20; i++) {
      state.warehouses.push({
        ...template,
        id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
        name: `Sinov ombori ${String(i).padStart(2, '0')}`,
      });
    }
    const total = state.warehouses.length;
    const user = userEvent.setup();

    expect(await screen.findByText(t.table.range(1, 12, total), {}, PAGE)).toBeInTheDocument();
    const shown = () =>
      state.warehouses.filter((w) => screen.queryByRole('link', { name: w.name }));
    expect(shown()).toHaveLength(12);

    await user.click(screen.getByRole('button', { name: t.table.last }));
    const lastFrom = Math.floor((total - 1) / 12) * 12 + 1;
    expect(
      await screen.findByText(t.table.range(lastFrom, total, total), {}, PAGE),
    ).toBeInTheDocument();
    await waitFor(() => expect(shown()).toHaveLength(total - lastFrom + 1));
  });
});

describe('mock API backend bilan bir xil (OWN-01, OWN-06, BR-21)', () => {
  function as(login: string) {
    const s = db();
    s.currentUserId = s.users.find((u) => u.login === login)!.id;
    return s;
  }

  it('sotuvchi: faqat biriktirilgan ACTIVE omborlar, ko‘rsatkichlarsiz; detal 403', async () => {
    renderApp('/login?redirect=%2Fwarehouses', { loggedOut: true });
    const s = as('dilnoza');
    const seller = s.users.find((u) => u.login === 'dilnoza')!;
    const assigned = seller.warehouseIds;
    const list = await mockRequest<Paginated<WarehouseListItemDto>>('/warehouses', {
      query: { status: 'INACTIVE' },
    });
    expect(list.data.map((w) => w.id).sort()).toEqual([...assigned].sort());
    for (const w of list.data) {
      expect(w).not.toHaveProperty('stockValue');
      expect(w).not.toHaveProperty('totalQuantity');
    }
    await expect(mockRequest(`/warehouses/${assigned[0]}`)).rejects.toMatchObject({ status: 403 });
    await expect(mockRequest(`/warehouses/${assigned[0]}/stock`)).rejects.toMatchObject({
      status: 403,
    });

    // Biriktirilgan ombor nofaol bo'lsa — ro'yxatdan yo'qoladi, biriktiruv saqlanadi.
    s.warehouses.find((w) => w.id === assigned[0])!.status = 'INACTIVE';
    const after = await mockRequest<Paginated<WarehouseListItemDto>>('/warehouses');
    expect(after.data.map((w) => w.id)).not.toContain(assigned[0]);
    expect(seller.warehouseIds).toContain(assigned[0]);
  });

  it('admin: ko‘rsatkichlar va kelgan narxidagi qiymat bor; noto‘g‘ri holat → 400', async () => {
    renderApp('/warehouses');
    as('admin');
    const list = await mockRequest<Paginated<WarehouseListItemDto>>('/warehouses');
    expect(list.data[0]).toHaveProperty('stockValue');
    expect(list.data[0]).toHaveProperty('productCount');
    await expect(
      mockRequest(`/warehouses/${list.data[0]!.id}/status`, {
        method: 'PATCH',
        body: { status: 'DELETED' },
      }),
    ).rejects.toMatchObject({ status: 400 });
  });
});
