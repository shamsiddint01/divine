import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { t } from '@/i18n/uz';
import { mockRequest } from '@/mocks';
import { db } from '@/mocks/db';
import { MOCK_DEMO_PASSWORD } from '@/mocks/handlers/auth.constants';
import { setMockNow } from '@/mocks/lib/clock';
import { todayInTashkent } from '@/shared/lib/format';
import { PAGE, renderApp } from '@/test/render-app';

async function loginAs(login: string) {
  const user = userEvent.setup();
  await user.type(await screen.findByLabelText(t.auth.login, {}, PAGE), login);
  await user.type(
    screen.getByLabelText(t.auth.password, { selector: 'input' }),
    MOCK_DEMO_PASSWORD,
  );
  await user.click(screen.getByRole('button', { name: t.auth.submit }));
  return user;
}

describe('Nasiya: admin (D-24)', () => {
  it('ro‘yxat va ertangi to‘lov eslatmasi: kim, qachon, qancha', async () => {
    renderApp('/credits');
    expect(
      await screen.findByRole('heading', { level: 1, name: t.nav.credits }, PAGE),
    ).toBeInTheDocument();
    const reminders = await screen.findByRole('region', { name: t.credits.reminders.title }, PAGE);
    expect(within(reminders).getByText(/Bobur Karimov.*to‘lashi kerak/)).toBeInTheDocument();
    expect(await screen.findByText('Dilshod Ergashev', {}, PAGE)).toBeInTheDocument();
  });

  it('50 000 ni 4 marta: forma teng bo‘lib ko‘rsatadi va jadval saqlanadi', async () => {
    setMockNow(new Date());
    renderApp('/credits');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: t.credits.add }, PAGE));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText(new RegExp(t.credits.form.name)), 'Ali Valiyev');
    await user.type(within(dialog).getByLabelText(new RegExp(t.credits.form.amount)), '50000');
    const count = within(dialog).getByLabelText(new RegExp(t.credits.form.installments));
    await user.clear(count);
    await user.type(count, '4');
    expect(await within(dialog).findByTestId('credit-preview')).toHaveTextContent(/4 marta/);
    expect(within(dialog).getByTestId('credit-preview')).toHaveTextContent(/12.500/);

    await user.click(within(dialog).getByRole('button', { name: t.common.add }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull(), PAGE);
    const created = db().credits.find((c) => c.debtorName === 'Ali Valiyev')!;
    expect(created.installments.map((r) => r.amount)).toEqual([
      '12500.00',
      '12500.00',
      '12500.00',
      '12500.00',
    ]);
  });

  it('to‘lov yozish: ortig‘i keyingi to‘lovdan ayriladi; qoldiqdan oshsa xato', async () => {
    const { router } = renderApp('/');
    await screen.findByRole('navigation', { name: t.nav.mainMenu }, PAGE);
    // renderApp soatni qotiradi, forma esa haqiqiy bugungi sanani yuboradi — mock soati ham bugunga.
    setMockNow(new Date());
    const today = todayInTashkent();
    await mockRequest('/credits', {
      method: 'POST',
      body: {
        debtorName: 'Tolov Sinov',
        amount: '50000',
        takenAt: new Date().toISOString(),
        firstDueDate: today,
        installments: 4,
      },
    });
    await router.navigate('/credits');
    const user = userEvent.setup();
    await user.click(await screen.findByText('Tolov Sinov', { selector: 'p' }, PAGE));
    const sheet = await screen.findByRole('dialog');
    const amount = await within(sheet).findByLabelText(
      new RegExp(t.credits.payment.amount),
      {},
      PAGE,
    );
    // Taklif — eng yaqin to'lov summasi.
    expect(amount).toHaveValue('12 500');
    await user.clear(amount);
    await user.type(amount, '20000');
    await user.click(within(sheet).getByRole('button', { name: t.credits.payment.submit }));
    await waitFor(() => {
      const c = db().credits.find((x) => x.debtorName === 'Tolov Sinov')!;
      expect(c.payments.map((p) => p.amount)).toEqual(['20000.00']);
    }, PAGE);
    await waitFor(() => expect(amount).toHaveValue('5 000'), PAGE);

    await user.clear(amount);
    await user.type(amount, '999999');
    await user.click(within(sheet).getByRole('button', { name: t.credits.payment.submit }));
    expect(await within(sheet).findByText(/Qolgan qarz/, {}, PAGE)).toBeInTheDocument();
  });

  it('qo‘ng‘iroqchada ertangi to‘lov ko‘rinadi', async () => {
    renderApp('/');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: t.topbar.notifications }, PAGE));
    expect(await screen.findByText(t.topbar.creditsTitle, {}, PAGE)).toBeInTheDocument();
    expect(await screen.findByText(/Bobur Karimov.*to‘lashi kerak/)).toBeInTheDocument();
  });
});

describe('Nasiya: sotuvchi ko‘rmaydi (D-24)', () => {
  it('menyuda yo‘q; URL bilan "Ruxsat yo‘q"; mock API 403', async () => {
    const { router } = renderApp('/login', { loggedOut: true });
    await loginAs('aziz');
    const nav = await screen.findByRole('navigation', { name: t.nav.mainMenu }, PAGE);
    expect(within(nav).queryByRole('link', { name: t.nav.credits })).toBeNull();
    await router.navigate('/credits');
    expect(
      await screen.findByRole('heading', { level: 1, name: t.forbidden.title }, PAGE),
    ).toBeInTheDocument();
    expect(screen.queryByText('Bobur Karimov')).toBeNull();
    for (const path of ['/credits', '/credits/reminders']) {
      await expect(mockRequest(path)).rejects.toMatchObject({ status: 403 });
    }
  });
});
