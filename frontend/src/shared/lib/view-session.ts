/**
 * Superadminning faqat-ko'rish sessiyasi: 30 daqiqalik token shu tabda turadi, sahifa yangilansa
 * ham ishlaydi. Refresh cookie'si yo'q, backend yozishni rad etadi (`READ_ONLY_SESSION`).
 */
const KEY = 'divine.view-token';

export function readViewToken(): string | null {
  try {
    return sessionStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function startViewSession(token: string): void {
  try {
    sessionStorage.setItem(KEY, token);
  } catch {
    // Saqlab bo'lmasa, oddiy kirish oqimi ishlaydi.
  }
}

export function endViewSession(): void {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    // Saqlash o'chiq: tozalash shart emas.
  }
}
