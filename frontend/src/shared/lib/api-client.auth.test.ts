import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __authorizedRequestForTests as request, ApiError, refreshSession } from './api-client';
import { authSession } from './auth-session';

interface Call {
  url: string;
  authorization: string | null;
}

/** Soxta server: `/auth/refresh` va himoyalangan endpoint (token bo'yicha 200/401). */
function fakeServer(opts: { validToken: string; refreshOk: boolean; locked?: boolean }) {
  const calls: Call[] = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input);
    const headers = new Headers(init?.headers);
    calls.push({ url, authorization: headers.get('Authorization') });
    const json = (status: number, body: unknown, extra: Record<string, string> = {}) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json', ...extra },
      });
    if (url.endsWith('/auth/refresh')) {
      return opts.refreshOk
        ? json(200, { accessToken: opts.validToken, expiresIn: 900, user: { id: 'u1' } })
        : json(401, {
            error: { code: 'SESSION_EXPIRED', message: 'Sessiya muddati tugadi. Qaytadan kiring' },
          });
    }
    if (url.endsWith('/auth/login') && opts.locked) {
      return json(
        423,
        { error: { code: 'ACCOUNT_LOCKED', message: 'Bloklandi' } },
        { 'Retry-After': '840' },
      );
    }
    if (headers.get('Authorization') === `Bearer ${opts.validToken}`)
      return json(200, { ok: true });
    return json(401, { error: { code: 'UNAUTHENTICATED', message: 'Tizimga kirishingiz kerak' } });
  });
  return calls;
}

beforeEach(() => authSession.setToken(null));
afterEach(() => vi.restoreAllMocks());

describe('api-client: access token va refresh', () => {
  it('xotiradagi token Authorization header sifatida yuboriladi; localStorage ishlatilmaydi', async () => {
    const calls = fakeServer({ validToken: 'tok-1', refreshOk: true });
    authSession.setToken('tok-1');
    await expect(request('/products', {})).resolves.toEqual({ ok: true });
    expect(calls[0]?.authorization).toBe('Bearer tok-1');
    expect(JSON.stringify(localStorage)).not.toContain('tok-1');
    expect(JSON.stringify(sessionStorage)).not.toContain('tok-1');
  });

  it('401 → refresh → yangi token bilan qayta urinish', async () => {
    const calls = fakeServer({ validToken: 'tok-new', refreshOk: true });
    authSession.setToken('tok-old');
    await expect(request('/products', {})).resolves.toEqual({ ok: true });
    expect(calls.map((c) => c.url.replace(/^.*\/api\/v1/, ''))).toEqual([
      '/products',
      '/auth/refresh',
      '/products',
    ]);
    expect(calls[2]?.authorization).toBe('Bearer tok-new');
    expect(authSession.getToken()).toBe('tok-new');
  });

  it('bir vaqtdagi bir nechta 401 → BITTA refresh so‘rovi (single-flight)', async () => {
    const calls = fakeServer({ validToken: 'tok-new', refreshOk: true });
    authSession.setToken('tok-old');
    await Promise.all([request('/a', {}), request('/b', {}), request('/c', {})]);
    expect(calls.filter((c) => c.url.endsWith('/auth/refresh'))).toHaveLength(1);
  });

  it('refresh ham o‘tmasa → sessiya tugadi (listener), xato uzatiladi, token tozalanadi', async () => {
    fakeServer({ validToken: 'tok-new', refreshOk: false });
    authSession.setToken('tok-old');
    const expired = vi.fn();
    const off = authSession.onExpired(expired);
    await expect(request('/products', {})).rejects.toMatchObject({ status: 401 });
    expect(expired).toHaveBeenCalledTimes(1);
    expect(authSession.getToken()).toBeNull();
    off();
  });

  it('login/refresh/logout endpointlarida 401 → refresh qilinmaydi', async () => {
    const calls = fakeServer({ validToken: 'tok', refreshOk: true });
    await expect(refreshSession()).resolves.toMatchObject({ accessToken: 'tok' });
    await expect(request('/auth/logout', { method: 'POST' })).rejects.toBeInstanceOf(ApiError);
    expect(calls.filter((c) => c.url.endsWith('/auth/refresh'))).toHaveLength(1);
  });

  it('423 lock — Retry-After soniyalari xatoda (login sahifasi xabari uchun)', async () => {
    fakeServer({ validToken: 'tok', refreshOk: true, locked: true });
    await expect(request('/auth/login', { method: 'POST', body: {} })).rejects.toMatchObject({
      status: 423,
      code: 'ACCOUNT_LOCKED',
      retryAfterSeconds: 840,
    });
  });

  it('refresh paytida server ishlamasa — "aloqa yo‘q" (sessiya tugadi deb hisoblanmaydi)', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'));
    const expired = vi.fn();
    const off = authSession.onExpired(expired);
    await expect(refreshSession()).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
    authSession.setToken('tok');
    await expect(request('/products', {})).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
    expect(expired).not.toHaveBeenCalled();
    off();
  });
});
