import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { t } from '@/i18n/uz';
import { db, resetEphemeralDb } from '@/mocks/db';
import { PAGE, TEST_NOW, renderApp } from '@/test/render-app';

type User = ReturnType<typeof userEvent.setup>;

/** Tasdiq oynasi chiqadi, "Bekor qilish" bilan yopiladi — amal bajarilmaydi. */
async function confirmShownThenCancel(user: User, title: string) {
  const dialog = await screen.findByRole('alertdialog', {}, PAGE);
  expect(within(dialog).getByText(title)).toBeInTheDocument();
  await user.click(within(dialog).getByRole('button', { name: t.common.cancel }));
  await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
}

/** Jadvalning birinchi qatoridagi "Amallar menyusi"dan bandni tanlash. */
async function firstRowAction(user: User, item: string) {
  const [first] = await screen.findAllByRole('button', { name: t.common.openActions }, PAGE);
  await user.click(first!);
  await user.click(await screen.findByRole('menuitem', { name: item }));
}

// BR-33 / REQ-153 (Phase 14): o'chirish, arxivlash, bloklash, kirimni tasdiqlash yoki bekor qilish
// tasdiqsiz bajarilmaydi. Bloklash, parolni tiklash, ombor va kategoriyani nofaol qilish, kategoriya
// va guruhni arxivlash — o'z sahifa testlarida.
describe('BR-33: destructive amallar tasdiq oynasisiz bajarilmaydi', () => {
  it('xarajatni o‘chirish', async () => {
    renderApp('/expenses');
    const user = userEvent.setup();
    const alive = () => db().expenses.filter((e) => !e.deletedAt).length;
    const before = alive();
    await firstRowAction(user, t.common.delete);
    await confirmShownThenCancel(user, t.expenses.deleteTitle);
    expect(alive()).toBe(before);
  });

  it('mahsulot guruhini o‘chirish', async () => {
    renderApp('/product-groups');
    const user = userEvent.setup();
    const group = db().groups[0]!;
    const row = (await screen.findByText(group.name, {}, PAGE)).closest('tr')!;
    await user.click(within(row).getByRole('button', { name: t.common.delete }));
    await confirmShownThenCancel(user, t.groups.deleteTitle(group.name));
    expect(db().groups.some((g) => g.id === group.id)).toBe(true);
  });

  it('mahsulotni nofaol qilish (arxivlash)', async () => {
    renderApp('/products');
    const user = userEvent.setup();
    const active = () => db().products.filter((p) => p.status === 'ACTIVE').length;
    const before = active();
    await firstRowAction(user, t.products.statusChange.deactivate);
    await confirmShownThenCancel(user, t.products.statusChange.deactivateTitle);
    expect(active()).toBe(before);
  });

  it('kirimni tasdiqlash va bekor qilish', async () => {
    const draft = resetEphemeralDb(TEST_NOW).incoming.find((d) => d.status === 'DRAFT')!;
    renderApp(`/incoming/${draft.id}`);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: t.incoming.form.confirm }, PAGE));
    await confirmShownThenCancel(user, t.incoming.form.confirmTitle);
    await user.click(screen.getByRole('button', { name: t.incoming.form.cancelDoc }));
    await confirmShownThenCancel(user, t.incoming.form.cancelTitle);
    expect(db().incoming.find((d) => d.id === draft.id)?.status).toBe('DRAFT');
  });

  it('POS: savatni tozalash', async () => {
    renderApp('/sales');
    const user = userEvent.setup();
    const cards = await screen.findAllByRole('button', { name: /so‘m/ }, PAGE);
    await user.click(cards.find((c) => !c.hasAttribute('disabled'))!);
    await user.click(screen.getByRole('button', { name: t.sales.clear }));
    await confirmShownThenCancel(user, t.sales.clearTitle);
    expect(screen.getByLabelText(new RegExp(t.sales.cart.quantity))).toBeInTheDocument();
  });

  it('demo ma’lumotlarni tiklash (mock)', async () => {
    renderApp('/settings');
    const user = userEvent.setup();
    const before = db().sales.length;
    db().sales.pop();
    await user.click(await screen.findByRole('button', { name: t.settings.resetDemo }, PAGE));
    await confirmShownThenCancel(user, t.settings.resetDemoTitle);
    expect(db().sales.length).toBe(before - 1);
  });
});
