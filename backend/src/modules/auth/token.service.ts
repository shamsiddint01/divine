import { createHash, randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ROLE_CODES, type RoleCode } from '@divine/shared';
import { jwtVerify, SignJWT } from 'jose';
import { InjectConfig } from '../../config/config.module.js';
import type { AppConfig } from '../../config/env.schema.js';

export const JWT_ISSUER = 'divine.uz';
export const JWT_AUDIENCE = 'divine.uz/api';
const ALGORITHM = 'HS256';
const CLOCK_TOLERANCE_SECONDS = 30;
/** Superadmin ko'rish rejimi shuncha davom etadi. */
const VIEW_TTL_SECONDS = 30 * 60;
/** Superadmin paneli sessiyasi. */
export const CONTROL_TTL_SECONDS = 12 * 3600;
const CONTROL_AUDIENCE = 'divine.uz/control';

/** Imzosi va muddati tekshirilgan access token ma'lumoti (SECURITY §2). */
export interface AccessClaims {
  sub: string;
  role: RoleCode;
  /** Berilgan vaqt, soniya. */
  iat: number;
  /** Superadmin ko'rish rejimi: faqat o'qish. */
  view?: boolean;
}

/**
 * Access JWT va refresh token (SECURITY §2, §3).
 * - Access: HS256 (verifikatsiyada algoritm qat'iy — `none` va boshqalar rad etiladi), `iss`/`aud`,
 *   payload'da faqat `sub` va `role`. Permissionlar har so'rovda DB'dan olinadi.
 * - Refresh: 256 bit tasodifiy opaque satr; DB'da faqat SHA-256 hash'i saqlanadi.
 */
@Injectable()
export class TokenService {
  private readonly key: Uint8Array;

  constructor(@InjectConfig() private readonly config: AppConfig) {
    this.key = new TextEncoder().encode(config.JWT_ACCESS_SECRET);
  }

  get accessTtlSeconds(): number {
    return this.config.JWT_ACCESS_TTL_SECONDS;
  }

  async signAccessToken(subject: { userId: string; role: RoleCode }, now: Date): Promise<string> {
    const iat = Math.floor(now.getTime() / 1000);
    return new SignJWT({ role: subject.role })
      .setProtectedHeader({ alg: ALGORITHM, typ: 'JWT' })
      .setSubject(subject.userId)
      .setIssuer(JWT_ISSUER)
      .setAudience(JWT_AUDIENCE)
      .setIssuedAt(iat)
      .setExpirationTime(iat + this.config.JWT_ACCESS_TTL_SECONDS)
      .sign(this.key);
  }

  /** Ko'rish tokeni: oddiy access token, lekin `view` belgisi bilan (JwtAuthGuard yozishni rad etadi). */
  async signViewToken(
    subject: { userId: string; role: RoleCode },
    now: Date,
  ): Promise<{ token: string; expiresAt: string }> {
    const iat = Math.floor(now.getTime() / 1000);
    const exp = iat + VIEW_TTL_SECONDS;
    const token = await new SignJWT({ role: subject.role, view: true })
      .setProtectedHeader({ alg: ALGORITHM, typ: 'JWT' })
      .setSubject(subject.userId)
      .setIssuer(JWT_ISSUER)
      .setAudience(JWT_AUDIENCE)
      .setIssuedAt(iat)
      .setExpirationTime(exp)
      .sign(this.key);
    return { token, expiresAt: new Date(exp * 1000).toISOString() };
  }

  async signControlToken(adminId: string, now: Date): Promise<string> {
    const iat = Math.floor(now.getTime() / 1000);
    return new SignJWT({})
      .setProtectedHeader({ alg: ALGORITHM, typ: 'JWT' })
      .setSubject(adminId)
      .setIssuer(JWT_ISSUER)
      .setAudience(CONTROL_AUDIENCE)
      .setIssuedAt(iat)
      .setExpirationTime(iat + CONTROL_TTL_SECONDS)
      .sign(this.key);
  }

  async verifyControlToken(token: string, now: Date): Promise<string | null> {
    try {
      const { payload } = await jwtVerify(token, this.key, {
        algorithms: [ALGORITHM],
        issuer: JWT_ISSUER,
        audience: CONTROL_AUDIENCE,
        currentDate: now,
        requiredClaims: ['sub', 'exp'],
      });
      return payload.sub ?? null;
    } catch {
      return null;
    }
  }

  /** Yaroqsiz (imzo, algoritm, iss/aud, muddat, format) bo'lsa — `null`. */
  async verifyAccessToken(token: string, now: Date): Promise<AccessClaims | null> {
    try {
      const { payload } = await jwtVerify(token, this.key, {
        algorithms: [ALGORITHM],
        issuer: JWT_ISSUER,
        audience: JWT_AUDIENCE,
        clockTolerance: CLOCK_TOLERANCE_SECONDS,
        currentDate: now,
        requiredClaims: ['sub', 'iat', 'exp'],
      });
      const role = payload.role;
      if (typeof payload.sub !== 'string' || !ROLE_CODES.includes(role as RoleCode)) return null;
      return {
        sub: payload.sub,
        role: role as RoleCode,
        iat: payload.iat!,
        ...(payload.view === true ? { view: true } : {}),
      };
    } catch {
      return null;
    }
  }
}

/** Yangi refresh token: `crypto.randomBytes(32)` → base64url (256 bit). */
export function generateRefreshToken(): string {
  return randomBytes(32).toString('base64url');
}

/** DB'da saqlanadigan identifikator: SHA-256 hex (token o'zi saqlanmaydi). */
export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/** Refresh token formati (43 belgi base64url) — noto'g'ri qiymat DB'ga so'rovsiz rad etiladi. */
export const REFRESH_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
