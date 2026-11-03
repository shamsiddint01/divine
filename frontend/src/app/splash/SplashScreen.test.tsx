import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { playSplash, playSplashOnce } from '@/shared/lib/splash';
import { SplashScreen } from './SplashScreen';

describe('SplashScreen', () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("o'zi ko'rinmaydi (/welcome, /login) — faqat signal bilan", () => {
    render(<SplashScreen />);
    expect(screen.queryByTestId('splash')).toBeNull();
  });

  it("logindan keyin (`playSplash`) ko'rinadi va animatsiyadan keyin o'zi yo'qoladi", () => {
    render(<SplashScreen />);
    act(() => playSplash());
    expect(screen.getByTestId('splash')).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(3700));
    expect(screen.getByTestId('splash')).toHaveClass('is-exiting');
    act(() => vi.advanceTimersByTime(1000));
    expect(screen.queryByTestId('splash')).toBeNull();
  });

  it('ichki saytga kirganda (`playSplashOnce`) — sessiyada bir marta; logindan keyin yana', () => {
    render(<SplashScreen />);
    act(() => playSplashOnce());
    expect(screen.getByTestId('splash')).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(3700));
    act(() => vi.advanceTimersByTime(1000));
    act(() => playSplashOnce());
    expect(screen.queryByTestId('splash')).toBeNull();
    act(() => playSplash());
    expect(screen.getByTestId('splash')).toBeInTheDocument();
  });

  it("signal komponent o'rnatilishidan oldin kelsa ham ijro etiladi", () => {
    playSplashOnce();
    render(<SplashScreen />);
    expect(screen.getByTestId('splash')).toBeInTheDocument();
  });

  it("bosilsa o'tkazib yuboriladi", () => {
    render(<SplashScreen />);
    act(() => playSplash());
    fireEvent.click(screen.getByTestId('splash'));
    expect(screen.getByTestId('splash')).toHaveClass('is-skipped');
    act(() => vi.advanceTimersByTime(400));
    expect(screen.queryByTestId('splash')).toBeNull();
  });
});
