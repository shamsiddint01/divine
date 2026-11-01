import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { t } from '@/i18n/uz';
import { MOCK_DEMO_PASSWORD } from '@/mocks/handlers/auth.constants';
import { PAGE, renderApp } from '@/test/render-app';

async function fillAndSubmit(login: string, password: string) {
  const user = userEvent.setup();
  const loginInput = await screen.findByLabelText(t.auth.login, {}, PAGE);
  await user.clear(loginInput);
  if (login) await user.type(loginInput, login);
  const passwordInput = screen.getByLabelText(t.auth.password, { selector: 'input' });
  await user.clear(passwordInput);
  if (password) await user.type(passwordInput, password);
  await user.click(screen.getByRole('button', { name: t.auth.submit }));
  return { user, loginInput, passwordInput };
}

describe('login sahifasi (mock auth)', () => {
  it('kirmagan mehmon: avval /welcome, "Kirish" → /login (qaytish manzili saqlanadi)', async () => {
    const { router } = renderApp('/products', { loggedOut: true });
    expect(
      await screen.findByRole('heading', { level: 1, name: t.landing.heroTitle }, PAGE),
    ).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/welcome');
    expect(router.state.location.search).toBe('?redirect=%2Fproducts');

    const [signIn] = screen.getAllByRole('link', { name: t.landing.signIn });
    await userEvent.click(signIn!);
    expect(
      await screen.findByRole('heading', { level: 1, name: t.auth.title }, PAGE),
    ).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/login');
    expect(router.state.location.search).toBe('?redirect=%2Fproducts');
  });

  it('bosh sahifa ("/") — kirmagan bo‘lsa /welcome ga, ortiqcha redirect’siz', async () => {
    const { router } = renderApp('/', { loggedOut: true });
    await waitFor(() => expect(router.state.location.pathname).toBe('/welcome'), PAGE);
    expect(router.state.location.search).toBe('');
  });

  it('bo‘sh forma → o‘zbekcha validatsiya xabarlari', async () => {
    renderApp('/login', { loggedOut: true });
    await fillAndSubmit('', '');
    expect(await screen.findByText('Loginni kiriting')).toBeInTheDocument();
    expect(screen.getByText('Parolni kiriting')).toBeInTheDocument();
  });

  it('noto‘g‘ri format: login probel bilan, parol 5 raqam', async () => {
    renderApp('/login', { loggedOut: true });
    await fillAndSubmit('ali vali', '12345');
    expect(await screen.findByText(/Login faqat lotin harflari/)).toBeInTheDocument();
    expect(screen.getByText('Parol aynan 6 ta raqamdan iborat bo‘lishi kerak')).toBeInTheDocument();
  });

  it('noto‘g‘ri parol → umumiy xato, parol maydoni tozalanadi', async () => {
    renderApp('/login', { loggedOut: true });
    const { passwordInput } = await fillAndSubmit('admin', '000000');
    expect(await screen.findByRole('alert')).toHaveTextContent('Login yoki parol noto‘g‘ri');
    expect(passwordInput).toHaveValue('');
  });

  it('bloklangan user (to‘g‘ri parol) → "Hisobingiz bloklangan"', async () => {
    renderApp('/login', { loggedOut: true });
    await fillAndSubmit('bekzod', MOCK_DEMO_PASSWORD);
    expect(await screen.findByRole('alert')).toHaveTextContent(/bloklangan/);
  });

  it('parolni ko‘rsatish/yashirish tugmasi (klaviatura bilan ham)', async () => {
    renderApp('/login', { loggedOut: true });
    const user = userEvent.setup();
    const input = await screen.findByLabelText(t.auth.password, { selector: 'input' }, PAGE);
    expect(input).toHaveAttribute('type', 'password');
    const toggle = screen.getByRole('button', { name: t.auth.showPassword });
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    toggle.focus();
    await user.keyboard('{Enter}');
    expect(input).toHaveAttribute('type', 'text');
    expect(screen.getByRole('button', { name: t.auth.hidePassword })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('muvaffaqiyatli kirish → redirect manziliga (case-insensitive login)', async () => {
    const { router } = renderApp('/login?redirect=%2Fproducts', { loggedOut: true });
    await fillAndSubmit('ADMIN', MOCK_DEMO_PASSWORD);
    await waitFor(() => expect(router.state.location.pathname).toBe('/products'));
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Mahsulotlar' }, PAGE),
    ).toBeInTheDocument();
  });

  it('demo rejimda kirish ma’lumoti ko‘rsatiladi; "Demo hisob bilan kirish" bir bosishda kiradi', async () => {
    const { router } = renderApp('/login', { loggedOut: true });
    expect(
      await screen.findByText(t.auth.demoHint(MOCK_DEMO_PASSWORD), {}, PAGE),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: t.auth.demoSignIn }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
  });

  it('"Parolni unutdingizmi?" izohni ochadi; "Bosh sahifa" /welcome ga qaytaradi', async () => {
    const { router } = renderApp('/login', { loggedOut: true });
    const forgot = await screen.findByRole('button', { name: t.auth.forgot }, PAGE);
    expect(forgot).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText(t.auth.passwordHint)).toBeNull();
    await userEvent.click(forgot);
    expect(forgot).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText(t.auth.passwordHint)).toHaveAttribute('id', 'login-password-hint');
    // Label o'zgarmagan: parol maydoni hamon "Parol" nomi bilan topiladi
    expect(screen.getByLabelText(t.auth.password, { selector: 'input' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: new RegExp(t.landing.tryFree) })).toHaveAttribute(
      'href',
      'https://t.me/+BvvsmvXvWZQ1YjAy',
    );
    await userEvent.click(screen.getByRole('link', { name: t.auth.backHome }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/welcome'));
  });
});

describe('logout va RBAC (UX)', () => {
  it('logout → toza /login (oldingi sahifaga redirect yo‘q); keyin himoyalangan sahifa → /welcome', async () => {
    const { router } = renderApp('/products');
    const nav = await screen.findByRole('navigation', { name: t.nav.mainMenu }, PAGE);
    const sidebar = nav.closest('aside') ?? document.body;
    await userEvent.click(
      within(sidebar as HTMLElement).getByRole('button', { name: t.topbar.logout }),
    );
    await waitFor(() => expect(router.state.location.pathname).toBe('/login'));
    expect(router.state.location.search).toBe('');
    // Himoyalangan sahifa ochilmaydi — mehmon sifatida tanishtiruv sahifasiga
    await router.navigate('/users');
    await waitFor(() => expect(router.state.location.pathname).toBe('/welcome'));
  });

  it('USER: menyuda faqat ruxsat etilgan bo‘limlar; admin bo‘limi URL bilan → "Ruxsat yo‘q"', async () => {
    const { router } = renderApp('/login', { loggedOut: true });
    await fillAndSubmit('aziz', MOCK_DEMO_PASSWORD);
    const nav = await screen.findByRole('navigation', { name: t.nav.mainMenu }, PAGE);
    const links = within(nav)
      .getAllByRole('link')
      .map((link) => link.textContent);
    expect(links).toEqual(['Bosh sahifa', 'Sotuvlar', 'Mahsulotlar', 'Xarajatlar']);
    // Telefon pastki menyusi: admin guruhlari yo'q; bitta bo'limli guruh — to'g'ridan-to'g'ri havola.
    const bottom = screen.getByRole('navigation', { name: t.nav.bottomMenu });
    expect(
      within(bottom)
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual(['Asosiy']);
    expect(
      within(bottom)
        .getAllByRole('link')
        .map((a) => [a.textContent, a.getAttribute('href')]),
    ).toEqual([
      // Kassa — sotuvchining asosiy ishi, pastki panel o'rtasida alohida tugma.
      ['Sotuv', '/sales'],
      ['Katalog', '/products'],
      ['Operatsiyalar', '/expenses'],
    ]);
    await router.navigate('/users');
    expect(
      await screen.findByRole('heading', { level: 1, name: t.forbidden.title }, PAGE),
    ).toBeInTheDocument();
  });
});
