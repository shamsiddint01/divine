import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { t } from '@/i18n/uz';
import { db } from '@/mocks/db';
import { MOCK_DEMO_PASSWORD } from '@/mocks/handlers/auth.constants';
import { stockKey } from '@/mocks/state';
import { PAGE, renderApp } from '@/test/render-app';

type User = ReturnType<typeof userEvent.setup>;

async function choose(user: User, dialog: HTMLElement, label: RegExp, option: string) {
  await user.click(within(dialog).getByRole('combobox', { name: label }));
  await user.click(await screen.findByRole('option', { name: option }));
}

const activeWarehouse = () => db().warehouses.find((w) => w.status === 'ACTIVE')!;

describe('Mahsulot qo‘shish + boshlang‘ich qoldiq (sobiq "Kirim")', () => {
  it('miqdor kiritilsa — mahsulot va qoldiq birga saqlanadi (tasdiqlangan kirim hujjati)', async () => {
    renderApp('/products');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: t.products.add }, PAGE));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(t.products.form.sectionStock)).toBeInTheDocument();
    // Kelgan narxi oynada bitta (qoldiq bo'limida takrorlanmaydi).
    expect(within(dialog).getAllByLabelText(new RegExp(t.products.form.costPrice))).toHaveLength(1);

    const name = 'Boshlang‘ich qoldiqli test mahsulot';
    await user.type(within(dialog).getByLabelText(new RegExp(t.products.form.name)), name);
    const group = db().groups.find((g) => g.isActive)!;
    await choose(user, dialog, new RegExp(t.products.form.group), group.name);
    await user.type(within(dialog).getByLabelText(new RegExp(t.products.form.costPrice)), '700');
    await user.type(within(dialog).getByLabelText(new RegExp(t.products.form.salePrice)), '900');
    const warehouse = activeWarehouse();
    await user.type(within(dialog).getByLabelText(new RegExp(t.products.stock.quantity)), '12');

    // Miqdor bor, ombor tanlanmagan (bir nechta faol ombor) — maydon ostida xabar, hech narsa saqlanmaydi.
    if (db().warehouses.filter((w) => w.status === 'ACTIVE').length > 1) {
      await user.click(within(dialog).getByRole('button', { name: t.common.create }));
      expect(
        await within(dialog).findByText(t.products.form.stockWarehouseRequired, {}, PAGE),
      ).toBeInTheDocument();
      expect(db().products.some((p) => p.name === name)).toBe(false);
      await choose(user, dialog, new RegExp(t.products.stock.warehouse), warehouse.name);
    }

    await user.click(within(dialog).getByRole('button', { name: t.common.create }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull(), PAGE);
    const created = db().products.find((p) => p.name === name)!;
    const warehouseId = db().incoming.find((d) =>
      d.items.some((i) => i.productId === created.id),
    )?.warehouseId;
    expect(warehouseId).toBeDefined();
    expect(db().stock[stockKey(warehouseId!, created.id)]).toBe('12.000');
    expect(
      db().incoming.find((d) => d.items.some((i) => i.productId === created.id)),
    ).toMatchObject({ status: 'CONFIRMED', items: [{ quantity: '12', costPrice: '700' }] });
  });

  it('miqdor bo‘sh — oddiy mahsulot (kirim hujjati yo‘q); tahrirlashda qoldiq bo‘limi yo‘q', async () => {
    renderApp('/products');
    const user = userEvent.setup();
    const before = db().incoming.length;
    await user.click(await screen.findByRole('button', { name: t.products.add }, PAGE));
    const dialog = await screen.findByRole('dialog');
    const name = 'Qoldiqsiz test mahsulot';
    await user.type(within(dialog).getByLabelText(new RegExp(t.products.form.name)), name);
    await choose(
      user,
      dialog,
      new RegExp(t.products.form.group),
      db().groups.find((g) => g.isActive)!.name,
    );
    await user.type(within(dialog).getByLabelText(new RegExp(t.products.form.costPrice)), '10');
    await user.type(within(dialog).getByLabelText(new RegExp(t.products.form.salePrice)), '20');
    await user.click(within(dialog).getByRole('button', { name: t.common.create }));
    await waitFor(() => expect(db().products.some((p) => p.name === name)).toBe(true), PAGE);
    expect(db().incoming.length).toBe(before);
  });
});

describe('Qoldiq qo‘shish (mavjud mahsulot)', () => {
  it('tafsilotdan: ombor qoldig‘i oshadi; kartadagi kelgan narxi o‘zgarmaydi (D-16)', async () => {
    const product = db().products.find((p) => p.status === 'ACTIVE' && p.barcode)!;
    renderApp(`/products?q=${product.barcode}`);
    const user = userEvent.setup();
    const table = await screen.findByRole('table', {}, PAGE);
    await waitFor(() => expect(within(table).getAllByRole('row').length).toBe(2), PAGE);
    await user.click(within(table).getAllByRole('row')[1] as HTMLElement);
    const sheet = await screen.findByRole('dialog');
    await user.click(await within(sheet).findByRole('button', { name: t.products.stock.add }, PAGE));

    const dialog = await screen.findByRole('dialog', { name: t.products.stock.title });
    const warehouse = activeWarehouse();
    await choose(user, dialog, new RegExp(t.products.stock.warehouse), warehouse.name);
    const qty = product.allowDecimal ? '2.5' : '3';
    await user.type(within(dialog).getByLabelText(new RegExp(t.products.stock.quantity)), qty);
    const before = db().stock[stockKey(warehouse.id, product.id)] ?? '0.000';
    await user.click(within(dialog).getByRole('button', { name: t.products.stock.submit }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull(), PAGE);
    const after = db().stock[stockKey(warehouse.id, product.id)];
    expect(Number(after)).toBeCloseTo(Number(before) + Number(qty), 3);
    expect(db().products.find((p) => p.id === product.id)!.costPrice).toBe(product.costPrice);
  });

  it('sotuvchi: “Qoldiq qo‘shish” va boshlang‘ich qoldiq ko‘rinmaydi', async () => {
    renderApp('/login?redirect=%2Fproducts', { loggedOut: true });
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText(t.auth.login, {}, PAGE), 'aziz');
    await user.type(
      screen.getByLabelText(t.auth.password, { selector: 'input' }),
      MOCK_DEMO_PASSWORD,
    );
    await user.click(screen.getByRole('button', { name: t.auth.submit }));
    const table = await screen.findByRole('table', {}, PAGE);
    await waitFor(() => expect(within(table).getAllByRole('row').length).toBeGreaterThan(1));
    await user.click(within(table).getAllByRole('row')[1] as HTMLElement);
    const sheet = await screen.findByRole('dialog');
    await within(sheet).findByText(t.products.detail.basicInfo, {}, PAGE);
    expect(within(sheet).queryByRole('button', { name: t.products.stock.add })).toBeNull();
    expect(screen.queryByRole('button', { name: t.products.add })).toBeNull();
  });

  it('eski /incoming manzili /products ga yo‘naltiriladi', async () => {
    const { router } = renderApp('/incoming/new');
    await waitFor(() => expect(router.state.location.pathname).toBe('/products'), PAGE);
  });
});
