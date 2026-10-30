import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { t } from '@/i18n/uz';
import { db } from '@/mocks/db';
import { PAGE, renderApp } from '@/test/render-app';

describe('Mahsulot guruhlari (Phase 14: ConfirmDialog)', () => {
  it('arxivlash tasdiq so‘raydi; bekor qilinsa o‘zgarmaydi; arxivdan chiqarish darhol', async () => {
    renderApp('/product-groups');
    const user = userEvent.setup();
    const group = db().groups.find((g) => g.isActive)!;
    const row = (await screen.findByText(group.name, {}, PAGE)).closest('tr')!;

    await user.click(within(row).getByRole('button', { name: t.groups.archive }));
    let dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText(t.groups.archiveTitle(group.name))).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: t.common.cancel }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(db().groups.find((g) => g.id === group.id)?.isActive).toBe(true);

    await user.click(within(row).getByRole('button', { name: t.groups.archive }));
    dialog = await screen.findByRole('alertdialog');
    await user.click(within(dialog).getByRole('button', { name: t.groups.archive }));
    await waitFor(() => expect(db().groups.find((g) => g.id === group.id)?.isActive).toBe(false));

    await user.click(await within(row).findByRole('button', { name: t.groups.restore }, PAGE));
    await waitFor(() => expect(db().groups.find((g) => g.id === group.id)?.isActive).toBe(true));
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });
});
