/** Logotip animatsiyasini (app/splash/SplashScreen) qayta ijro etish signali — masalan, logindan keyin. */
export const SPLASH_EVENT = 'divine:splash';

export function playSplash(): void {
  window.dispatchEvent(new Event(SPLASH_EVENT));
}
