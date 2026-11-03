import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { playSplash } from '@/shared/lib/splash';
import { SplashScreen } from './SplashScreen';

describe('SplashScreen', () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("birinchi kirishda ko'rinadi, animatsiyadan keyin o'zi yo'qoladi", () => {
    render(<SplashScreen />);
    expect(screen.getByTestId('splash')).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(3700));
    expect(screen.getByTestId('splash')).toHaveClass('is-exiting');
    act(() => vi.advanceTimersByTime(1000));
    expect(screen.queryByTestId('splash')).toBeNull();
  });

  it("shu sessiyada qayta ko'rsatilmaydi", () => {
    sessionStorage.setItem('divine.splash-seen', '1');
    render(<SplashScreen />);
    expect(screen.queryByTestId('splash')).toBeNull();
  });

  it("bosilsa o'tkazib yuboriladi", () => {
    render(<SplashScreen />);
    fireEvent.click(screen.getByTestId('splash'));
    expect(screen.getByTestId('splash')).toHaveClass('is-skipped');
    act(() => vi.advanceTimersByTime(400));
    expect(screen.queryByTestId('splash')).toBeNull();
  });

  it("`playSplash` (logindan keyin) — sessiyada ko'rilgan bo'lsa ham qayta ijro etiladi", () => {
    sessionStorage.setItem('divine.splash-seen', '1');
    render(<SplashScreen />);
    expect(screen.queryByTestId('splash')).toBeNull();
    act(() => playSplash());
    expect(screen.getByTestId('splash')).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(3700));
    act(() => vi.advanceTimersByTime(1000));
    expect(screen.queryByTestId('splash')).toBeNull();
  });
});
