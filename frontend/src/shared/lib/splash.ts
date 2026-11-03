/**
 * Logotip animatsiyasini (app/splash/SplashScreen) ishga tushirish. Faqat ichki saytda (egasining qarori,
 * 2026-11-03): logindan keyin har safar, ichki saytga kirganda esa sessiyada bir marta. `/welcome` va
 * `/login` da ko'rsatilmaydi.
 */
export const SPLASH_EVENT = 'divine:splash';
const SEEN_KEY = 'divine.splash-seen';

/** Splash hali tinglay boshlamagan bo'lsa (birinchi render) — u o'rnatilganda o'zi oladi. */
let pending = false;

export function consumePendingSplash(): boolean {
  const was = pending;
  pending = false;
  return was;
}

/** Har doim ijro etadi (logindan keyin). */
export function playSplash(): void {
  try {
    sessionStorage.setItem(SEEN_KEY, '1');
  } catch {
    // Xotira yopiq — faqat shu safar.
  }
  pending = true;
  window.dispatchEvent(new Event(SPLASH_EVENT));
}

/** Ichki saytga kirganda: shu brauzer sessiyasida hali ko'rsatilmagan bo'lsa. */
export function playSplashOnce(): void {
  try {
    if (sessionStorage.getItem(SEEN_KEY) === '1') return;
  } catch {
    // Xotira yopiq — ko'rsatamiz.
  }
  playSplash();
}
