import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { t } from '@/i18n/uz';
import { mockRequest } from '@/mocks';
import { recordAudit } from '@/mocks/audit';
import { PAGE, renderApp } from '@/test/render-app';

describe('Audit jurnali sahifasi (Phase 13, Sozlamalar ichida)', () => {
  it('admin: tab, yozuv, tafsilot ("oldin → keyin"); faqat o‘qish — tahrirlash tugmasi yo‘q', async () => {
    const { state } = renderApp('/settings');
    const user = userEvent.setup();
    const before = state.settings.companyName;
    await mockRequest('/settings', { method: 'PATCH', body: { companyName: 'Audit Savdo' } });

    await user.click(await screen.findByRole('tab', { name: t.settings.tabs.audit }, PAGE));
    const row = await screen.findByRole(
      'row',
      { name: new RegExp(t.audit.actions.SETTINGS_UPDATED) },
      PAGE,
    );
    expect(
      within(row).getByText(state.users.find((u) => u.id === state.currentUserId)!.fullName!),
    ).toBeInTheDocument();
    await user.click(row);
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(`${t.audit.keys.companyName}:`)).toBeInTheDocument();
    expect(within(dialog).getByText(before)).toBeInTheDocument();
    expect(within(dialog).getByText('Audit Savdo')).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: /tahrirlash|o‘chirish/i })).toBeNull();
  });

  it('cursor: 50 tadan ko‘p yozuv — "Yana yuklash" keyingi sahifani qo‘shadi; amal filtri', async () => {
    renderApp('/settings?tab=audit');
    const user = userEvent.setup();
    for (let i = 0; i < 55; i++) {
      recordAudit({
        action: 'PRODUCT_GROUP_CREATED',
        entityType: 'PRODUCT_GROUP',
        metadata: { name: `G${i}` },
      });
    }
    recordAudit({ action: 'WAREHOUSE_CREATED', entityType: 'WAREHOUSE', metadata: { name: 'W' } });
    expect(await screen.findByText(t.audit.shown(50), {}, PAGE)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: t.audit.loadMore }));
    expect(await screen.findByText(t.audit.shown(56), {}, PAGE)).toBeInTheDocument();
    expect(screen.getByText(t.audit.end)).toBeInTheDocument();

    await user.click(screen.getByRole('combobox', { name: t.audit.filters.allActions }));
    await user.click(
      await screen.findByRole('option', { name: t.audit.actions.WAREHOUSE_CREATED }),
    );
    await waitFor(() => expect(screen.getByText(t.audit.shown(1))).toBeInTheDocument(), PAGE);
  });
});
