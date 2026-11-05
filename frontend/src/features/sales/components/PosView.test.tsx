import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { WALK_IN_CUSTOMER_NAME } from '@divine/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { t } from '@/i18n/uz';
import { setMockLatency } from '@/mocks';
import { db } from '@/mocks/db';
import { FAIL_MESSAGE, failRoutes, restoreRoutes } from '@/test/fail-routes';
import { PAGE, renderApp } from '@/test/render-app';

afterEach(() => {
  restoreRoutes();
  vi.restoreAllMocks();
});

describe('POS — sotuv oqimi', () => {
  it('mijoz ismisiz sotuv "Noma’lum mijoz"ga yoziladi; ism kiritilsa — shu mijozga', async () => {
    const { state } = renderApp('/sales');
    const user = userEvent.setup();
    const addFirstProduct = async () => {
      const cards = await screen.findAllByRole('button', { name: /so‘m/ }, PAGE);
      const card = cards.find((c) => !c.hasAttribute('disabled'));
      if (!card) throw new Error('mahsulot topilmadi');
      await user.click(card);
      expect(await screen.findByLabelText(new RegExp(t.sales.cart.quantity))).toBeInTheDocument();
    };
    const closeReceipt = async () => {
      await user.keyboard('{Escape}');
      await waitFor(() => expect(screen.queryByText(t.sales.receipt.title)).toBeNull());
    };

    const salesBefore = state.sales.length;
    await addFirstProduct();
    await user.click(screen.getByRole('button', { name: t.sales.confirm }));
    let dialog = await screen.findByRole('dialog', {}, PAGE);
    expect(within(dialog).getByText(t.sales.receipt.title)).toBeInTheDocument();
    expect(within(dialog).getByText(WALK_IN_CUSTOMER_NAME)).toBeInTheDocument();
    await waitFor(() => expect(state.sales.length).toBe(salesBefore + 1));
    await closeReceipt();

    await addFirstProduct();
    await user.type(screen.getByLabelText(new RegExp(t.sales.customer.name)), 'Test Mijoz');
    await user.click(screen.getByRole('button', { name: t.sales.confirm }));
    dialog = await screen.findByRole('dialog', {}, PAGE);
    expect(within(dialog).getByText('Test Mijoz')).toBeInTheDocument();
    await waitFor(() => expect(state.sales.length).toBe(salesBefore + 2));
  });

  it('Dona/Optom: tugma mahsulotlar sarlavhasi ostida, shtrix-koddan tepada; sotuv optom narxda', async () => {
    const { state } = renderApp('/sales');
    const user = userEvent.setup();
    const product = state.products.find((p) => p.status === 'ACTIVE' && p.wholesalePrice)!;
    const group = await screen.findByRole('radiogroup', { name: t.sales.priceType.label }, PAGE);
    const retail = within(group).getByRole('radio', { name: t.sales.priceType.RETAIL });
    const wholesale = within(group).getByRole('radio', { name: t.sales.priceType.WHOLESALE });
    expect(retail).toHaveAttribute('aria-checked', 'true');
    const barcode = await screen.findByPlaceholderText(t.sales.barcodePlaceholder, {}, PAGE);
    expect(group.compareDocumentPosition(barcode) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    await user.click(wholesale);
    expect(wholesale).toHaveAttribute('aria-checked', 'true');
    await user.type(screen.getByPlaceholderText(t.sales.searchPlaceholder), product.name);
    const card = await screen.findByRole(
      'button',
      { name: new RegExp(product.name.replace(/[()]/g, '.')) },
      PAGE,
    );
    await user.click(card);
    const salesBefore = state.sales.length;
    await user.click(await screen.findByRole('button', { name: t.sales.confirm }, PAGE));
    const dialog = await screen.findByRole('dialog', {}, PAGE);
    expect(within(dialog).getByText(t.sales.priceType.WHOLESALE)).toBeInTheDocument();
    await waitFor(() => expect(state.sales.length).toBe(salesBefore + 1));
    const sale = state.sales.at(-1)!;
    expect(sale.priceType).toBe('WHOLESALE');
    expect(sale.items[0]?.unitPrice).toBe(product.wholesalePrice);
  });

  it('tanlangan turda narxi yo‘q mahsulot sotilmaydi: kartada "Narx yo‘q"', async () => {
    const { state } = renderApp('/sales');
    const user = userEvent.setup();
    const product = state.products.find((p) => p.status === 'ACTIVE')!;
    product.wholesalePrice = null;
    const group = await screen.findByRole('radiogroup', { name: t.sales.priceType.label }, PAGE);
    await user.click(within(group).getByRole('radio', { name: t.sales.priceType.WHOLESALE }));
    await user.type(screen.getByPlaceholderText(t.sales.searchPlaceholder), product.name);
    const name = new RegExp(product.name.replace(/[()]/g, '.'));
    await waitFor(async () => {
      const card = await screen.findByRole('button', { name });
      expect(card).toHaveTextContent(t.sales.noPrice);
      expect(card).toBeDisabled();
    }, PAGE);
  });

  it('savat ostida jami mahsulot soni ko‘rsatiladi', async () => {
    renderApp('/sales');
    const user = userEvent.setup();
    const cards = await screen.findAllByRole('button', { name: /so‘m/ }, PAGE);
    const card = cards.find((c) => !c.hasAttribute('disabled'));
    if (!card) throw new Error('mahsulot topilmadi');
    await user.click(card);
    await user.click(card);
    expect(await screen.findByText(t.sales.cart.totalQuantity('2'))).toBeInTheDocument();
  });

  it('omborlar yuklanmasa xato holati ("ombor biriktirilmagan" emas), qayta urinishda tiklanadi', async () => {
    failRoutes(['/warehouses']);
    renderApp('/sales');
    const alert = await screen.findByRole('alert', {}, PAGE);
    expect(alert).toHaveTextContent(FAIL_MESSAGE);
    expect(screen.queryByText(t.sales.noWarehouse)).toBeNull();

    restoreRoutes();
    await userEvent.setup().click(within(alert).getByRole('button', { name: t.common.retry }));
    expect((await screen.findAllByRole('button', { name: /so‘m/ }, PAGE)).length).toBeGreaterThan(
      0,
    );
  });

  it('mahsulotlar yuklanmasa xato holati; mijoz tavsiyalari yuklanmasa sabab aytiladi', async () => {
    failRoutes(['/products', '/customers']);
    renderApp('/sales');
    expect(await screen.findByRole('alert', {}, PAGE)).toHaveTextContent(FAIL_MESSAGE);
    expect(screen.queryByText(t.sales.productsEmpty)).toBeNull();

    const user = userEvent.setup();
    await user.type(screen.getByLabelText(new RegExp(t.sales.customer.name)), 'Az');
    expect(
      await screen.findByText(t.sales.customer.suggestionsFailed, {}, PAGE),
    ).toBeInTheDocument();
  });

  it('shtrix-kodlar ketma-ket tez skanerlansa — ikkala mahsulot ham savatda (Phase 15)', async () => {
    renderApp('/sales');
    const user = userEvent.setup();
    const scan = await screen.findByLabelText(t.sales.barcodeLabel, {}, PAGE);
    await screen.findAllByRole('button', { name: /so‘m/ }, PAGE);
    const inStock = db().products.filter((p) => p.barcode && p.status === 'ACTIVE');
    const [a, b] = inStock;
    setMockLatency(300, 300);
    await user.type(scan, `${a!.barcode}{Enter}${b!.barcode}{Enter}`);
    expect(scan).toHaveValue('');
    await waitFor(
      () => expect(screen.getAllByLabelText(new RegExp(t.sales.cart.quantity))).toHaveLength(2),
      PAGE,
    );
    setMockLatency(0, 0);
  });

  it('xl dan kichik ekranda savat pastki paneldan ochiladi; kartada savatdagi miqdor ko‘rinadi', async () => {
    const real = window.matchMedia;
    vi.spyOn(window, 'matchMedia').mockImplementation((query: string) => ({
      ...real(query),
      matches: query.includes('1279.98px'),
    }));
    renderApp('/sales');
    const user = userEvent.setup();

    const cards = await screen.findAllByRole('button', { name: /so‘m/ }, PAGE);
    const card = cards.find((c) => !c.hasAttribute('disabled'));
    if (!card) throw new Error('mahsulot topilmadi');
    // Bo'sh savatda panel ko'rinmaydi, savat yon ustunda ham yo'q.
    expect(screen.queryByRole('button', { name: new RegExp(t.sales.cart.open) })).toBeNull();
    expect(screen.queryByText(t.sales.cart.empty)).toBeNull();

    await user.click(card);
    await user.click(card);
    expect(card).toHaveTextContent(t.sales.cart.inCart('2'));

    await user.click(screen.getByRole('button', { name: new RegExp(t.sales.cart.open) }));
    const sheet = await screen.findByRole('dialog', {}, PAGE);
    expect(within(sheet).getByLabelText(new RegExp(t.sales.cart.quantity))).toHaveValue('2');
    expect(within(sheet).getByRole('button', { name: t.sales.confirm })).toBeEnabled();
  });
});
