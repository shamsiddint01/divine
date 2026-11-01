import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { t } from '@/i18n/uz';
import { PAGE, renderApp } from '@/test/render-app';

const TELEGRAM = 'https://t.me/+BvvsmvXvWZQ1YjAy';

describe('landing sahifa (/welcome)', () => {
  it('login’siz ochiladi va "Kirish" /login ga olib boradi', async () => {
    const { router } = renderApp('/welcome', { loggedOut: true });
    expect(
      await screen.findByRole('heading', { level: 1, name: t.landing.heroTitle }, PAGE),
    ).toBeInTheDocument();
    const features = screen.getByRole('region', { name: t.landing.featuresTitle });
    expect(within(features).getAllByRole('listitem')).toHaveLength(4);
    expect(screen.getByRole('region', { name: t.landing.howTitle })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: t.landing.faqTitle })).toBeInTheDocument();

    const [signIn] = screen.getAllByRole('link', { name: t.landing.signIn });
    await userEvent.click(signIn!);
    await waitFor(() => expect(router.state.location.pathname).toBe('/login'));
  });

  it('"Bepul sinab ko‘rish" va "Bepul boshlash" Telegram kanalni yangi oynada ochadi', async () => {
    renderApp('/welcome', { loggedOut: true });
    const tryFree = await screen.findByRole('link', { name: new RegExp(t.landing.tryFree) }, PAGE);
    const start = screen.getByRole('link', { name: new RegExp(t.landing.start) });
    for (const link of [tryFree, start]) {
      expect(link).toHaveAttribute('href', TELEGRAM);
      expect(link).toHaveAttribute('target', '_blank');
      expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'));
    }
  });

  it('telefon menyusi bo‘limlarni va kirish tugmalarini ko‘rsatadi', async () => {
    renderApp('/welcome', { loggedOut: true });
    await userEvent.click(await screen.findByRole('button', { name: t.landing.menuOpen }, PAGE));
    const menu = await screen.findByRole('dialog');
    expect(
      within(menu)
        .getAllByRole('link')
        .map((a) => a.textContent),
    ).toEqual([
      t.landing.nav.features,
      t.landing.nav.how,
      t.landing.nav.faq,
      t.landing.signIn,
      expect.stringContaining(t.landing.start),
    ]);
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
});
