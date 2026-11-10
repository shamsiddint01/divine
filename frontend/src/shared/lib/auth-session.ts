/**
 * Access token — FAQAT xotirada (SECURITY §1): `localStorage`/`sessionStorage`da emas, XSS bo'lsa ham
 * saqlangan tokenni o'g'irlab bo'lmaydi. Sahifa yangilansa, sessiya HttpOnly refresh cookie orqali
 * qayta tiklanadi (`POST /auth/refresh`). Refresh token JS'ga umuman ko'rinmaydi.
 *
 * Bu modul api-client va session feature o'rtasidagi bog'lovchi (aylanma import bo'lmasligi uchun).
 */
let accessToken: string | null = null;

type Listener = () => void;
/** `message` — sayt yopiq (to'lov muddati yoki texnik ishlar): login sahifasida shu matn chiqadi. */
type ExpiredListener = (message?: string) => void;
const expiredListeners = new Set<ExpiredListener>();
const forbiddenListeners = new Set<Listener>();

export const authSession = {
  getToken: (): string | null => accessToken,
  setToken(token: string | null): void {
    accessToken = token;
  },
  /** Refresh ham o'tmadi — foydalanuvchi qayta kirishi kerak. */
  onExpired(listener: ExpiredListener): () => void {
    expiredListeners.add(listener);
    return () => expiredListeners.delete(listener);
  },
  notifyExpired(message?: string): void {
    accessToken = null;
    for (const listener of expiredListeners) listener(message);
  },
  /** 403 — permissionlar o'zgargan bo'lishi mumkin (RBAC §5): `/auth/me` qayta yuklanadi. */
  onForbidden(listener: Listener): () => void {
    forbiddenListeners.add(listener);
    return () => forbiddenListeners.delete(listener);
  },
  notifyForbidden(): void {
    for (const listener of forbiddenListeners) listener();
  },
};
