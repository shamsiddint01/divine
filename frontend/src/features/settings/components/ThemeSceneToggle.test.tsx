import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { t } from '@/i18n/uz';
import { useUiStore } from '@/stores/ui.store';
import { PAGE } from '@/test/render-app';
import { ThemeSceneToggle } from './ThemeSceneToggle';
import { sceneParams } from './theme-scene';

const reducedMotion = () => {
  const real = window.matchMedia;
  vi.spyOn(window, 'matchMedia').mockImplementation((query: string) => ({
    ...real(query),
    matches: query.includes('prefers-reduced-motion'),
  }));
};

afterEach(() => {
  act(() => useUiStore.getState().setTheme('dark'));
  localStorage.removeItem('divine.theme');
});

describe('ThemeSceneToggle', () => {
  it('standart — tungi rejim; bosilganda kunduzgi rejimga o‘tadi (UI o‘tish o‘rtasida almashadi)', async () => {
    reducedMotion();
    render(<ThemeSceneToggle />);
    const toggle = screen.getByRole('switch', { name: t.settings.themeScene.toDay });
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    expect(toggle).toHaveTextContent(t.settings.themeScene.night);

    await userEvent.click(toggle);
    await waitFor(() => expect(useUiStore.getState().theme).toBe('light'), PAGE);
    expect(document.documentElement).not.toHaveClass('dark');
    expect(localStorage.getItem('divine.theme')).toBe('light');
    const back = await screen.findByRole('switch', { name: t.settings.themeScene.toNight }, PAGE);
    expect(back).toHaveAttribute('aria-checked', 'true');
    await waitFor(() => expect(back).toHaveAttribute('aria-busy', 'false'), PAGE);

    await userEvent.click(back);
    await waitFor(() => expect(useUiStore.getState().theme).toBe('dark'), PAGE);
    expect(document.documentElement).toHaveClass('dark');
  });

  it('o‘tish paytidagi qayta bosish e’tiborsiz qoldiriladi', async () => {
    render(<ThemeSceneToggle />);
    const toggle = screen.getByRole('switch');
    await userEvent.click(toggle);
    await userEvent.click(toggle);
    await waitFor(() => expect(useUiStore.getState().theme).toBe('light'), PAGE);
    await waitFor(() => expect(toggle).toHaveAttribute('aria-busy', 'false'), PAGE);
    // Ikkinchi bosish tunga qaytarmagan
    expect(useUiStore.getState().theme).toBe('light');
  });

  it('mavzu boshqa joyda o‘zgarsa banner darhol moslashadi', () => {
    render(<ThemeSceneToggle />);
    act(() => useUiStore.getState().setTheme('light'));
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('switch')).toHaveTextContent(t.settings.themeScene.day);
  });
});

describe('sahna kalit kadrlari', () => {
  it('tun → tong: yulduzlar so‘nadi, quyosh ufqdan ko‘tariladi; kunduz → tun: aksincha', () => {
    const night = sceneParams({ dir: 'toDay', p: 0, direct: false });
    const day = sceneParams({ dir: 'toDay', p: 1, direct: false });
    expect(night.night).toBe(1);
    expect(night.sun).toBeLessThan(0);
    expect(day.night).toBe(0);
    expect(day.sun).toBe(1);
    // Tong va shom — iliq ufq (to'q sariq/oltin), tinch holatlarda yo'q
    expect(sceneParams({ dir: 'toDay', p: 0.62, direct: false }).warmth).toBeGreaterThan(0.9);
    expect(sceneParams({ dir: 'toNight', p: 0.6, direct: false }).warmth).toBeGreaterThan(0.9);
    expect(day.warmth).toBeLessThan(0.01);
    // Shomda ufq rangi to'q sariqqa (qizil kanal yuqori, ko'k past)
    const sunset = sceneParams({ dir: 'toNight', p: 0.62, direct: false }).sky.horizon;
    expect(sunset[0]).toBeGreaterThan(240);
    expect(sunset[2]).toBeLessThan(100);
    expect(sceneParams({ dir: 'toNight', p: 1, direct: false }).night).toBe(1);
  });
});
