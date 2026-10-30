import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { t } from '@/i18n/uz';
import { PAGE, renderApp } from '@/test/render-app';

describe('ilova karkasi (layout)', () => {
  it('TZ §16 dagi 11 ta bo‘limni sidebar’da ko‘rsatadi', async () => {
    renderApp('/');
    // Layout sessiya tekshirilgandan keyin chiqadi (RequireAuth, mock sessiya).
    const nav = await screen.findByRole('navigation', { name: t.nav.mainMenu }, PAGE);
    for (const label of [
      'Bosh sahifa',
      'Userlar',
      'Mahsulotlar',
      'Mahsulot guruhlari',
      'Ombor',
      'Sotuvlar',
      'Mijozlar',
      'Kirim',
      'Xarajatlar',
      'Hisobotlar',
      'Sozlamalar',
    ]) {
      expect(within(nav).getByRole('link', { name: label })).toBeInTheDocument();
    }
  });

  it('mock rejimda "Demo rejim" belgisi ko‘rinadi', async () => {
    renderApp('/');
    expect(await screen.findByText(t.topbar.demoBadge, {}, PAGE)).toBeInTheDocument();
  });

  it('dashboard real (mock) ma’lumotdan KPI’larni ko‘rsatadi', async () => {
    renderApp('/');
    expect(await screen.findByText(t.dashboard.kpi.todaySales, {}, PAGE)).toBeInTheDocument();
    expect(await screen.findByText(t.dashboard.kpi.lowStock)).toBeInTheDocument();
    expect(await screen.findByText(t.dashboard.greeting('Akmal'))).toBeInTheDocument();
  });

  it('navigatsiya orqali sahifa almashadi va active holat o‘zgaradi', async () => {
    const { router } = renderApp('/');
    const nav = await screen.findByRole('navigation', { name: t.nav.mainMenu }, PAGE);
    await userEvent.click(within(nav).getByRole('link', { name: 'Kirim' }));
    expect(router.state.location.pathname).toBe('/incoming');
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Kirim' }, PAGE),
    ).toBeInTheDocument();
    expect(within(nav).getByRole('link', { name: 'Kirim' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  it('noma’lum sahifa uchun 404 holati', async () => {
    renderApp('/mavjud-emas');
    expect(
      await screen.findByRole('heading', { level: 1, name: t.notFound.title }, PAGE),
    ).toBeInTheDocument();
    expect(screen.getByText(t.notFound.description)).toBeInTheDocument();
  });
});
