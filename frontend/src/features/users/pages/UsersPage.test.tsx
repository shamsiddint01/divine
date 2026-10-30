import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { t } from '@/i18n/uz';
import { db } from '@/mocks/db';
import { PAGE, renderApp } from '@/test/render-app';

describe('Userlar — yaratish (BR-01…BR-04)', () => {
  it('formada parol maydoni yo‘q; noto‘g‘ri login rad etiladi; yaratilganda 6 xonali parol bir marta ko‘rsatiladi', async () => {
    renderApp('/users');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: t.users.add }, PAGE));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).queryByLabelText(/parol/i)).not.toBeInTheDocument();

    const login = within(dialog).getByLabelText(new RegExp(t.users.form.login));
    await user.type(login, 'ali 1');
    await user.click(within(dialog).getByRole('button', { name: t.common.create }));
    expect(await within(dialog).findByText(/Login faqat lotin harflari/)).toBeInTheDocument();

    await user.clear(login);
    await user.type(login, 'yangiuser');
    await user.click(within(dialog).getByRole('button', { name: t.common.create }));

    const reveal = await screen.findByText(t.users.password.title);
    const passwordDialog = reveal.closest('[role="dialog"]') as HTMLElement;
    expect(within(passwordDialog).getByText(/^\d{6}$/)).toBeInTheDocument();
    expect(within(passwordDialog).getByText(t.users.password.warning)).toBeInTheDocument();
  });
});

/** Jadvaldagi user qatori (login bo'yicha). */
async function rowOf(login: string) {
  const cell = await screen.findByText(login, { selector: 'span.font-mono' }, PAGE);
  return cell.closest('tr') as HTMLElement;
}

async function openActions(login: string) {
  const user = userEvent.setup();
  const row = await rowOf(login);
  await user.click(within(row).getByRole('button', { name: t.common.openActions }));
  return { user, menu: await screen.findByRole('menu') };
}

describe('Userlar — boshqarish (Phase 5)', () => {
  it('o‘z qatorida: faqat tahrirlash (bloklash va parol tiklash yo‘q); boshqa userda — bor', async () => {
    renderApp('/users');
    const own = await openActions('admin');
    expect(within(own.menu).getByRole('menuitem', { name: t.common.edit })).toBeInTheDocument();
    expect(within(own.menu).queryByRole('menuitem', { name: t.users.block })).toBeNull();
    expect(within(own.menu).queryByRole('menuitem', { name: t.users.resetPassword })).toBeNull();
    await own.user.keyboard('{Escape}');

    const other = await openActions('aziz');
    expect(within(other.menu).getByRole('menuitem', { name: t.users.block })).toBeInTheDocument();
    expect(
      within(other.menu).getByRole('menuitem', { name: t.users.resetPassword }),
    ).toBeInTheDocument();
  });

  it('o‘zini tahrirlash: rol tanlovi o‘chirilgan, izoh bilan', async () => {
    renderApp('/users');
    const user = userEvent.setup();
    await user.click(await rowOf('admin'));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('combobox')).toBeDisabled();
    expect(within(dialog).getByText(t.users.form.selfRoleHint)).toBeInTheDocument();
  });

  it('ombor tanlovida faqat faol omborlar (`/users/warehouse-options`)', async () => {
    renderApp('/users'); // demo DB qayta yaratiladi — o'zgartirish undan keyin
    const [first, second] = db().warehouses;
    second!.status = 'INACTIVE';
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: t.users.add }, PAGE));
    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByText(first!.name)).toBeInTheDocument();
    expect(within(dialog).queryByText(second!.name)).toBeNull();
  });

  it('bloklash tasdiqlash oynasi orqali; parol tiklash yangi parolni bir marta ko‘rsatadi', async () => {
    renderApp('/users');
    const blockMenu = await openActions('aziz');
    await blockMenu.user.click(
      within(blockMenu.menu).getByRole('menuitem', { name: t.users.block }),
    );
    const confirm = await screen.findByRole('alertdialog');
    await blockMenu.user.click(within(confirm).getByRole('button', { name: t.users.block }));
    await waitFor(async () =>
      expect(within(await rowOf('aziz')).getByText(t.status.BLOCKED)).toBeInTheDocument(),
    );

    const resetMenu = await openActions('aziz');
    await resetMenu.user.click(
      within(resetMenu.menu).getByRole('menuitem', { name: t.users.resetPassword }),
    );
    const resetConfirm = await screen.findByRole('alertdialog');
    await resetMenu.user.click(
      within(resetConfirm).getByRole('button', { name: t.users.resetPassword }),
    );
    const reveal = await screen.findByText(t.users.password.title);
    const passwordDialog = reveal.closest('[role="dialog"]') as HTMLElement;
    const shown = within(passwordDialog).getByText(/^\d{6}$/).textContent;
    expect(shown).toBe(db().passwords?.[db().users.find((u) => u.login === 'aziz')!.id]);
  });
});
