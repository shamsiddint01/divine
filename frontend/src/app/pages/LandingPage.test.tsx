import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { t } from '@/i18n/uz';
import { PAGE, renderApp } from '@/test/render-app';

describe('landing sahifa (/welcome)', () => {
  it('login’siz ochiladi va "Kirish" tugmasi /login ga olib boradi', async () => {
    const { router } = renderApp('/welcome', { loggedOut: true });
    expect(
      await screen.findByRole('heading', { level: 1, name: t.landing.heroTitle }, PAGE),
    ).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(4);

    await userEvent.click(screen.getByRole('link', { name: t.landing.signIn }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/login'));
  });
});
