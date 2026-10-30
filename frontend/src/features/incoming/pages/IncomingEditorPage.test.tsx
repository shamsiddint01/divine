import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { t } from '@/i18n/uz';
import { db, resetEphemeralDb } from '@/mocks/db';
import { setMockLatency } from '@/mocks';
import { FAIL_MESSAGE, failRoutes, restoreRoutes } from '@/test/fail-routes';
import { PAGE, TEST_NOW, renderApp } from '@/test/render-app';

afterEach(restoreRoutes);

describe('Kirim formasi — dinamik jami (TZ §7, BR-11, AC-07/08)', () => {
  it('50 + 30 + 100 + 20 = 200 dona; miqdor o‘zgarsa jami darhol yangilanadi', async () => {
    // Seed deterministik: renderApp ham aynan shu holatni (shu ID'lar bilan) yaratadi.
    const draft = resetEphemeralDb(TEST_NOW).incoming.find((d) => d.status === 'DRAFT');
    if (!draft) throw new Error('qoralama topilmadi');
    const { router } = renderApp(`/incoming/${draft.id}`);
    expect(router.state.location.pathname).toBe(`/incoming/${draft.id}`);

    const total = await screen.findByTestId('incoming-total-quantity', {}, PAGE);
    await waitFor(() => expect(total).toHaveTextContent(t.incoming.form.totalQuantityValue('200')));

    const firstQty = screen.getByLabelText(`${t.incoming.form.quantity} 1`);
    expect(firstQty).toHaveValue('50');
    await userEvent.clear(firstQty);
    await userEvent.type(firstQty, '60');
    expect(total).toHaveTextContent(t.incoming.form.totalQuantityValue('210'));

    await userEvent.click(screen.getByRole('button', { name: t.incoming.form.addRow }));
    expect(screen.getByText(t.incoming.form.positions(5))).toBeInTheDocument();
  });

  it('mahsulot tanlovi: ro‘yxat yuklanmasa "topilmadi" emas, xato va qayta urinish', async () => {
    renderApp('/incoming/new');
    const user = userEvent.setup();
    await screen.findByRole('button', { name: t.incoming.form.addRow }, PAGE);
    const trigger = document.getElementById('in-product-0');
    if (!trigger) throw new Error('mahsulot tanlovi topilmadi');
    // Ro'yxat faqat ochilganda so'raladi: shu so'rov xato qaytaradi.
    failRoutes(['/products']);
    await user.click(trigger);

    const listbox = await screen.findByRole('listbox', {}, PAGE);
    const alert = await within(listbox).findByRole('alert', {}, PAGE);
    expect(alert).toHaveTextContent(FAIL_MESSAGE);
    expect(within(listbox).queryByText(t.products.noResults)).toBeNull();

    restoreRoutes();
    await user.click(within(alert).getByRole('button', { name: t.common.retry }));
    expect((await within(listbox).findAllByRole('option', {}, PAGE)).length).toBeGreaterThan(0);
  });

  it('shtrix-kodlar ketma-ket tez kelsa — hech biri yo‘qolmaydi, kiritilgan miqdor saqlanadi (Phase 15)', async () => {
    renderApp('/incoming/new');
    const user = userEvent.setup();
    const [a, b] = db().products.filter((p) => p.barcode && p.status === 'ACTIVE');
    const scan = await screen.findByLabelText(t.incoming.form.barcode, {}, PAGE);
    await screen.findByRole('button', { name: t.incoming.form.addRow }, PAGE);
    setMockLatency(300, 300);
    // Ikkinchi kod birinchisi hali qidirilayotganda keladi (skaner tezligi).
    await user.type(scan, `${a!.barcode}{Enter}${b!.barcode}{Enter}`);
    expect(scan).toHaveValue('');
    const qty2 = await screen.findByLabelText(`${t.incoming.form.quantity} 2`, {}, PAGE);
    const qty1 = screen.getByLabelText(`${t.incoming.form.quantity} 1`);
    await user.clear(qty1);
    await user.type(qty1, '50');
    // Uchinchi skan (takroriy A) kutilayotganda foydalanuvchi 2-qatorni tahrirlaydi.
    await user.type(scan, `${a!.barcode}{Enter}`);
    await user.clear(qty2);
    await user.type(qty2, '30');
    await waitFor(() => expect(qty1).toHaveValue('51'), PAGE);
    expect(qty2).toHaveValue('30');
    expect(screen.getByTestId('incoming-total-quantity')).toHaveTextContent(
      t.incoming.form.totalQuantityValue('81'),
    );
    setMockLatency(0, 0);
  });
});
