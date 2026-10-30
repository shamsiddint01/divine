import { ErrorCode } from '@divine/shared';
import type { Request, Response } from 'express';
import { AppError } from '../../common/errors/app-error.js';
import type { AppConfig } from '../../config/env.schema.js';
import type { RequestMeta } from '../audit/audit.service.js';

/** Refresh cookie (SECURITY §1): `HttpOnly; Secure; SameSite=Strict; Path=/api/v1/auth`. */
export const REFRESH_COOKIE = 'dv_refresh';
export const REFRESH_COOKIE_PATH = '/api/v1/auth';

function cookieOptions(config: AppConfig) {
  return {
    httpOnly: true,
    secure: config.AUTH_COOKIE_SECURE,
    sameSite: 'strict' as const,
    path: REFRESH_COOKIE_PATH,
  };
}

export function setRefreshCookie(
  res: Response,
  config: AppConfig,
  token: string,
  expiresAt: Date,
  now: Date,
): void {
  res.cookie(REFRESH_COOKIE, token, {
    ...cookieOptions(config),
    maxAge: Math.max(0, expiresAt.getTime() - now.getTime()),
  });
}

/** Logout va yaroqsiz sessiya: cookie o'chiriladi (`Max-Age=0`, xuddi shu atributlar bilan). */
export function clearRefreshCookie(res: Response, config: AppConfig): void {
  res.cookie(REFRESH_COOKIE, '', { ...cookieOptions(config), maxAge: 0 });
}

/** `Cookie` header'idan refresh token (cookie-parser'siz — faqat bitta cookie kerak). */
export function readRefreshCookie(req: Request): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    if (part.slice(0, index).trim() === REFRESH_COOKIE) {
      try {
        return decodeURIComponent(part.slice(index + 1).trim()) || undefined;
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}

/**
 * CSRF (SECURITY §9) — cookie bilan ishlaydigan `POST /auth/refresh` va `POST /auth/logout` uchun:
 * 1) `SameSite=Strict` cookie; 2) `Origin` header `CORS_ORIGINS` ro'yxatida; 3) `X-Requested-With:
 * XMLHttpRequest` — cross-origin so'rovda CORS preflight'ni majburlaydi, preflight esa begona origin
 * uchun rad etiladi. Buzilsa — `403 FORBIDDEN`.
 */
export function assertCsrfSafe(req: Request, config: AppConfig): void {
  const origin = req.headers.origin;
  const requestedWith = req.headers['x-requested-with'];
  if (requestedWith !== 'XMLHttpRequest' || !origin || !config.CORS_ORIGINS.includes(origin)) {
    throw new AppError(ErrorCode.FORBIDDEN);
  }
}

export function requestMeta(req: Request & { id?: unknown }): RequestMeta {
  const userAgent = req.headers['user-agent'];
  return {
    ip: req.ip ?? null,
    userAgent: typeof userAgent === 'string' ? userAgent : null,
    requestId: typeof req.id === 'string' ? req.id : null,
  };
}
