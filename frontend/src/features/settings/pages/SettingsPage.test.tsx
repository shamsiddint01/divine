import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { t } from '@/i18n/uz';
import { db } from '@/mocks/db';
import { PAGE, renderApp } from '@/test/render-app';

describe('Sozlamalar (Phase 12, API §16, D-21)', () => {
  it('faqat 3 ta maydon tahrirlanadi; saqlashda o‘zgargan maydon yoziladi, chegara normallashtiriladi', async () => {
    renderApp('/settings');
    const user = userEvent.setup();
    const threshold = await screen.findByLabelText(
      t.settings.fields.lowStockThreshold,
      { exact: false },
      PAGE,
    );
    expect(
      screen.getByLabelText(t.settings.fields.companyName, { exact: false }),
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText(t.settings.fields.currencyLabel, { exact: false }),
    ).toBeInTheDocument();
    // Ilgari faqat mock'da bo'lgan maydonlar (yuridik nom, STIR, standart ombor, kirimni tasdiqlash) yo'q.
    expect(screen.queryByText('Standart ombor')).toBeNull();
    expect(screen.queryByText('Kirimni tasdiqlashni talab qilish')).toBeNull();

    const before = { ...db().settings };
    await user.clear(threshold);
    await user.type(threshold, '7,50');
    await user.click(screen.getByRole('button', { name: t.common.saveChanges }));
    await waitFor(() => expect(db().settings.lowStockDefaultThreshold).toBe('7.5'), PAGE);
    expect(db().settings).toEqual({ ...before, lowStockDefaultThreshold: '7.5' });
  });

  it('saqlash paneli faqat o‘zgarish bo‘lganda; "Bekor qilish" qiymatni qaytaradi', async () => {
    renderApp('/settings');
    const user = userEvent.setup();
    const name = await screen.findByLabelText(
      t.settings.fields.companyName,
      { exact: false },
      PAGE,
    );
    const before = (name as HTMLInputElement).value;
    expect(screen.queryByRole('button', { name: t.common.saveChanges })).toBeNull();

    await user.type(name, ' X');
    expect(screen.getByRole('region', { name: t.settings.unsaved })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: t.common.cancel }));
    expect(name).toHaveValue(before);
    expect(screen.queryByRole('region', { name: t.settings.unsaved })).toBeNull();
  });
});
