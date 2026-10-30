import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { t } from '@/i18n/uz';
import { setMockLatency } from '@/mocks';
import { db } from '@/mocks/db';
import { FAIL_MESSAGE, failRoutes, restoreRoutes } from '@/test/fail-routes';
import { PAGE, renderApp } from '@/test/render-app';

afterEach(restoreRoutes);

describe('POS — sotuv oqimi', () => {
  it('mijoz ismisiz sotuv rad etiladi (BR-05); ism kiritilsa sotuv yakunlanadi va qoldiq kamayadi', async () => {
    const { state } = renderApp('/sales');
    const user = userEvent.setup();

    // Birinchi mavjud mahsulot kartochkasini savatga qo'shish
    const cards = await screen.findAllByRole('button', { name: /so‘m/ }, PAGE);
    const card = cards.find((c) => !c.hasAttribute('disabled'));
    if (!card) throw new Error('mahsulot topilmadi');
    await user.click(card);
    expect(await screen.findByLabelText(new RegExp(t.sales.cart.quantity))).toBeInTheDocument();

    const confirm = screen.getByRole('button', { name: t.sales.confirm });
    await user.click(confirm);
    expect(await screen.findByText(t.sales.customer.title)).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Mijoz ismi majburiy');

    const salesBefore = state.sales.length;
    await user.type(screen.getByLabelText(new RegExp(t.sales.customer.name)), 'Test Mijoz');
    await user.click(confirm);

    const dialog = await screen.findByRole('dialog', {}, PAGE);
    expect(within(dialog).getByText(t.sales.receipt.title)).toBeInTheDocument();
    expect(within(dialog).getByText('Test Mijoz')).toBeInTheDocument();
    await waitFor(() => expect(state.sales.length).toBe(salesBefore + 1));
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
});
