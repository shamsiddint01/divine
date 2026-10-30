import { create } from 'zustand';

/**
 * Sessiya holati (faqat xotirada). `checking` — ilova ochilganda sessiya tiklanmoqda (refresh cookie
 * yoki mock sessiya); `anonymous` — login sahifasi; `authenticated` — himoyalangan sahifalar.
 * Token o'zi bu yerda emas — `shared/lib/auth-session` (api-client bilan umumiy).
 */
export type SessionStatus = 'checking' | 'authenticated' | 'anonymous';

interface AuthState {
  status: SessionStatus;
  /**
   * Anonim holatga sabab: sessiya tugagani yoki server bilan aloqa yo'qligi (login sahifasida ko'rsatiladi);
   * `signedOut` — user o'zi chiqdi: keyingi kirish oldingi userning sahifasiga qaytarmaydi.
   */
  reason: 'expired' | 'offline' | 'signedOut' | null;
  setStatus: (status: SessionStatus, reason?: AuthState['reason']) => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  status: 'checking',
  reason: null,
  setStatus: (status, reason = null) => set({ status, reason }),
}));
