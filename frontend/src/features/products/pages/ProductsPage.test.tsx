import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { t } from '@/i18n/uz';
import { db } from '@/mocks/db';
import { MOCK_DEMO_PASSWORD } from '@/mocks/handlers/auth.constants';
import { mockRequest } from '@/mocks';
import { PAGE, renderApp } from '@/test/render-app';
import type { Paginated, ProductDto } from '@/shared/types/api';

const COST_HEADER = { name: new RegExp(t.products.col.costPrice) };

async function loginAsSeller() {
  const user = userEvent.setup();
  await user.type(await screen.findByLabelText(t.auth.login, {}, PAGE), 'aziz');
  await user.type(
    screen.getByLabelText(t.auth.password, { selector: 'input' }),
    MOCK_DEMO_PASSWORD,
  );
  await user.click(screen.getByRole('button', { name: t.auth.submit }));
  return user;
}

describe('Mahsulotlar: kelgan narxi faqat ruxsati borlarga (OWN-06)', () => {
  it('admin: “Kelgan narxi” ustuni va mahsulot qo‘shish tugmasi bor', async () => {
    renderApp('/products');
    expect(await screen.findByRole('columnheader', COST_HEADER, PAGE)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: t.products.add })).toBeInTheDocument();
  });

  it('admin: tafsilotdagi “Barcha sotuvlar” — shu mahsulot bo‘yicha to‘liq sotuv tarixi (REQ-053)', async () => {
    const s = db();
    const salesOf = (productId: string) =>
      s.sales.filter((sale) => sale.items.some((i) => i.productId === productId));
    const sold = s.products.find((x) => {
      const n = salesOf(x.id).length;
      return x.barcode && n > 0 && n < 20;
    })!;
    renderApp(`/products?q=${sold.barcode}`);
    const user = userEvent.setup();
    const table = await screen.findByRole('table', {}, PAGE);
    await waitFor(() => expect(within(table).getAllByRole('row').length).toBe(2), PAGE);
    await user.click(within(table).getAllByRole('row')[1] as HTMLElement);
    const sheet = await screen.findByRole('dialog');
    await user.click(
      await within(sheet).findByRole('link', { name: t.products.detail.allSales }, PAGE),
    );
    const history = await screen.findByRole('table', {}, PAGE);
    await waitFor(
      () => expect(within(history).getAllByRole('row').length).toBe(salesOf(sold.id).length + 1),
      PAGE,
    );
  });

  it('sotuvchi: ustun, qo‘shish/amallar yo‘q; tafsilot oynasida kelgan narxi va sotuvlar yo‘q', async () => {
    renderApp('/login?redirect=%2Fproducts', { loggedOut: true });
    const user = await loginAsSeller();
    const table = await screen.findByRole('table', {}, PAGE);
    await waitFor(() => expect(within(table).getAllByRole('row').length).toBeGreaterThan(1));
    expect(screen.queryByRole('columnheader', COST_HEADER)).toBeNull();
    expect(screen.queryByRole('button', { name: t.products.add })).toBeNull();
    expect(screen.queryByRole('button', { name: t.common.openActions })).toBeNull();

    await user.click(within(table).getAllByRole('row')[1] as HTMLElement);
    const sheet = await screen.findByRole('dialog');
    expect(await within(sheet).findByText(t.products.detail.basicInfo)).toBeInTheDocument();
    expect(within(sheet).queryByText(t.products.col.costPrice)).toBeNull();
    expect(within(sheet).queryByText(t.products.detail.recentSales)).toBeNull();
    expect(within(sheet).queryByRole('button', { name: t.common.edit })).toBeNull();
  });
});

describe('mock API backend bilan bir xil: sotuvchiga kelgan narxi berilmaydi', () => {
  async function asSeller() {
    renderApp('/login?redirect=%2Fproducts', { loggedOut: true });
    const s = db();
    s.currentUserId = s.users.find((u) => u.login === 'aziz')!.id;
    return s;
  }

  it('ro‘yxat va detalda `costPrice` kaliti yo‘q; summary 403; kelgan narxi bo‘yicha saralash 400', async () => {
    const s = await asSeller();
    const list = await mockRequest<Paginated<ProductDto>>('/products', { query: { pageSize: 5 } });
    expect(list.data.length).toBeGreaterThan(0);
    for (const p of list.data) expect(p).not.toHaveProperty('costPrice');
    const id = list.data[0]!.id;
    expect(await mockRequest<ProductDto>(`/products/${id}`)).not.toHaveProperty('costPrice');
    await expect(mockRequest(`/products/${id}/summary`)).rejects.toMatchObject({ status: 403 });
    await expect(
      mockRequest('/products', { query: { sort: 'costPrice:desc' } }),
    ).rejects.toMatchObject({ status: 400 });
    // Admin uchun esa bor.
    s.currentUserId = s.users.find((u) => u.login === 'admin')!.id;
    expect(await mockRequest<ProductDto>(`/products/${id}`)).toHaveProperty('costPrice');
  });
});

describe('Mahsulotlar jadvali: server-side qidiruv, saralash, pagination (REQ-155, Phase 14)', () => {
  /** Jadvalda ko'rinayotgan mahsulot nomlari (tartib bilan). */
  const shownNames = () =>
    screen
      .getAllByRole('row')
      .slice(1)
      .map((row) => row.querySelector('p.font-medium')?.textContent ?? '');
  /** Xuddi shu so'rovga server (mock API) javobi — UI uni o'zgartirmasdan ko'rsatishi kerak. */
  const serverNames = async (query: Record<string, string | number>) =>
    (await mockRequest<Paginated<ProductDto>>('/products', { query })).data.map((p) => p.name);

  it('narx: dona va optomdan kamida bittasi; faqat optom bilan ham saqlanadi', async () => {
    renderApp('/products');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: t.products.add }, PAGE));
    const dialog = await screen.findByRole('dialog');
    const name = 'Faqat optom mahsulot';
    await user.type(within(dialog).getByLabelText(new RegExp(t.products.form.name)), name);
    await user.click(within(dialog).getByRole('combobox', { name: /Guruh/ }));
    await user.click(
      await screen.findByRole('option', { name: db().groups.find((g) => g.isActive)!.name }),
    );
    await user.type(within(dialog).getByLabelText(new RegExp(t.products.form.costPrice)), '700');
    await user.click(within(dialog).getByRole('button', { name: t.common.create }));
    expect(await within(dialog).findByRole('alert', {}, PAGE)).toHaveTextContent(
      'Dona yoki optom narxidan kamida bittasini kiriting',
    );
    expect(db().products.some((p) => p.name === name)).toBe(false);

    await user.type(
      within(dialog).getByLabelText(new RegExp(t.products.form.wholesalePrice)),
      '900',
    );
    await user.click(within(dialog).getByRole('button', { name: t.common.create }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull(), PAGE);
    expect(db().products.find((p) => p.name === name)).toMatchObject({
      salePrice: null,
      wholesalePrice: '900',
    });
  });

  it('sahifa, saralash va qidiruv URL’da va server so‘rovida; jadval aynan server javobini ko‘rsatadi', async () => {
    const { router } = renderApp('/products?pageSize=10');
    const user = userEvent.setup();
    const base = { pageSize: 10, sort: 'name:asc' };
    const page1 = await serverNames({ ...base, page: 1 });
    await waitFor(() => expect(shownNames()).toEqual(page1), PAGE);

    await user.click(screen.getByRole('button', { name: t.table.next }));
    await waitFor(() => expect(router.state.location.search).toContain('page=2'));
    const page2 = await serverNames({ ...base, page: 2 });
    expect(page2.some((name) => page1.includes(name))).toBe(false);
    await waitFor(() => expect(shownNames()).toEqual(page2), PAGE);

    // Saralash o'zgarsa — 1-sahifaga qaytadi, tartibni server beradi.
    await user.click(
      screen.getByRole('button', { name: t.table.sortBy(t.products.col.salePrice) }),
    );
    await waitFor(() => expect(router.state.location.search).toContain('sort=salePrice%3Aasc'));
    expect(router.state.location.search).not.toContain('page=2');
    const byPrice = await serverNames({ pageSize: 10, page: 1, sort: 'salePrice:asc' });
    await waitFor(() => expect(shownNames()).toEqual(byPrice), PAGE);

    await user.type(screen.getByPlaceholderText(t.products.searchPlaceholder), 'Telefon');
    await waitFor(() => expect(router.state.location.search).toContain('q=Telefon'), PAGE);
    const found = await serverNames({
      pageSize: 10,
      page: 1,
      sort: 'salePrice:asc',
      search: 'Telefon',
    });
    expect(found.length).toBeGreaterThan(0);
    await waitFor(() => expect(shownNames()).toEqual(found), PAGE);
  });
});
