import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { t } from '@/i18n/uz';
import { PAGE, renderApp } from '@/test/render-app';

describe('ilova karkasi (layout)', () => {
  it('TZ §16 dagi 10 ta bo‘lim (Kirim — Mahsulotlar ichida)ni sidebar’da ko‘rsatadi', async () => {
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
    // Alohida "Kirim" bo'limi yo'q — qoldiq Mahsulotlar bo'limidan qo'shiladi.
    expect(within(nav).queryByRole('link', { name: 'Kirim' })).toBeNull();
    await userEvent.click(within(nav).getByRole('link', { name: 'Ombor' }));
    expect(router.state.location.pathname).toBe('/warehouses');
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Ombor' }, PAGE),
    ).toBeInTheDocument();
    expect(within(nav).getByRole('link', { name: 'Ombor' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  it('telefon pastki menyusi: 4 ta guruh; guruh bosilsa bo‘limlari ochiladi, havola sahifani almashtiradi', async () => {
    const { router } = renderApp('/');
    const bottom = await screen.findByRole('navigation', { name: t.nav.bottomMenu }, PAGE);
    expect(
      within(bottom)
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual(['Asosiy', 'Katalog', 'Operatsiyalar', 'Boshqaruv']);
    // Kassa — guruh ichida emas, alohida tugma.
    expect(within(bottom).getByRole('link', { name: t.nav.sellShort })).toHaveAttribute(
      'href',
      '/sales',
    );
    expect(within(bottom).getByRole('button', { name: 'Asosiy' })).toHaveAttribute(
      'aria-current',
      'page',
    );

    await userEvent.click(within(bottom).getByRole('button', { name: 'Katalog' }));
    const sheet = await screen.findByRole('dialog', { name: t.nav.sectionCatalog });
    expect(
      within(sheet)
        .getAllByRole('link')
        .map((a) => a.textContent),
    ).toEqual(['Mahsulotlar', 'Mahsulot guruhlari', 'Ombor']);

    await userEvent.click(within(sheet).getByRole('link', { name: 'Ombor' }));
    expect(router.state.location.pathname).toBe('/warehouses');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(within(bottom).getByRole('button', { name: 'Katalog' })).toHaveAttribute(
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
