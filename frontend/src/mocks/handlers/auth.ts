import {
  ALL_PERMISSIONS,
  loginRequestSchema,
  normalizeLogin,
  ROLE_PERMISSIONS,
} from '@divine/shared';
import type { CurrentUserDto } from '@/shared/types/api';
import { recordAudit } from '../audit';
import { db, persist } from '../db';
import { fail, route, validate } from '../lib/http';
import type { MockState, UserRow } from '../state';
import { MOCK_DEMO_PASSWORD } from './auth.constants';

export { MOCK_DEMO_PASSWORD };

/**
 * MOCK auth (`VITE_AUTH_MODE=mock`, standart) — docs/API.md §3 contract'ining aksi.
 * Haqiqiy backend'dagi lockout, rate limit va cookie yo'q; sessiya — `state.currentUserId`.
 * Demo: seed userlar `MOCK_DEMO_PASSWORD` bilan, mock'da yaratilgan userlar o'z (ko'rsatilgan) paroli bilan.
 */
const MOCK_ACCESS_TOKEN = 'mock-access-token';
const ACCESS_TTL_SECONDS = 900;

export function toCurrentUser(user: UserRow): CurrentUserDto {
  return {
    id: user.id,
    login: user.login,
    fullName: user.fullName,
    role: user.role,
    status: user.status,
    permissions: [
      ...(user.role === 'ADMIN' ? ALL_PERMISSIONS : ROLE_PERMISSIONS[user.role]),
    ].sort(),
    warehouseIds: [...user.warehouseIds],
  };
}

const passwordOf = (s: MockState, userId: string) => s.passwords?.[userId] ?? MOCK_DEMO_PASSWORD;

function currentUser(s: MockState): UserRow | undefined {
  const user = s.users.find((u) => u.id === s.currentUserId);
  return user?.status === 'ACTIVE' ? user : undefined;
}

const session = (user: UserRow) => ({
  accessToken: MOCK_ACCESS_TOKEN,
  expiresIn: ACCESS_TTL_SECONDS,
  user: toCurrentUser(user),
});

const unknownLoginMetadata = (login: string) =>
  /^\d{6}$/.test(login)
    ? { loginMasked: true, loginLength: login.length }
    : { loginLength: login.length };

route('POST', '/auth/login', ({ body }) => {
  const input = validate(loginRequestSchema, body);
  const s = db();
  const user = s.users.find((u) => normalizeLogin(u.login) === normalizeLogin(input.login));
  // Xato urinish ham audit'ga (backend kabi, actor — noma'lum). Javob xato bo'lgani uchun handler
  // tashqarisidagi saqlash ishlamaydi — shu yerda saqlanadi.
  const failed = (reason: 'INVALID_CREDENTIALS' | 'ACCOUNT_BLOCKED', extra: object): never => {
    recordAudit({
      action: 'AUTH_LOGIN_FAILED',
      entityType: 'SESSION',
      actorId: null,
      // SEC-01: noma'lum login parol bo'lishi mumkin — xom holda emas (backend kabi; brauzerda kalit
      // yo'q, shuning uchun barmoq izi ham yo'q — faqat uzunlik va parol shakli maskasi).
      metadata: {
        ...(user ? { login: user.login } : unknownLoginMetadata(input.login)),
        reason,
        ...extra,
      },
    });
    persist();
    return fail(reason === 'INVALID_CREDENTIALS' ? 401 : 403, reason);
  };
  // Haqiqiy backend kabi: login yo'q va parol noto'g'ri — bir xil javob.
  if (!user) return failed('INVALID_CREDENTIALS', { knownUser: false });
  if (passwordOf(s, user.id) !== input.password) {
    return failed('INVALID_CREDENTIALS', { userId: user.id });
  }
  if (user.status !== 'ACTIVE') return failed('ACCOUNT_BLOCKED', { userId: user.id });
  s.currentUserId = user.id;
  user.lastLoginAt = new Date().toISOString();
  recordAudit({
    action: 'AUTH_LOGIN_SUCCEEDED',
    entityType: 'SESSION',
    actorId: user.id,
    metadata: { login: user.login },
  });
  return session(user);
});

route('POST', '/auth/refresh', () => {
  const user = currentUser(db());
  if (!user) fail(401, 'SESSION_EXPIRED');
  return session(user);
});

route('POST', '/auth/logout', () => {
  const s = db();
  if (s.currentUserId) recordAudit({ action: 'AUTH_LOGOUT', entityType: 'SESSION' });
  s.currentUserId = '';
  return undefined;
});

route('GET', '/auth/me', (): CurrentUserDto => {
  const user = currentUser(db());
  if (!user) fail(401, 'UNAUTHENTICATED');
  return toCurrentUser(user);
});
