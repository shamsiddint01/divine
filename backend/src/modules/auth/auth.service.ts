import { Injectable } from '@nestjs/common';
import {
  AuditAction,
  AuditEntityType,
  type CurrentUser,
  ErrorCode,
  type LoginRequest,
  type LoginResponse,
} from '@divine/shared';
import { AppError } from '../../common/errors/app-error.js';
import { LoginFingerprint } from '../../common/security/login-fingerprint.js';
import { Clock } from '../../common/time/clock.js';
import { InjectConfig } from '../../config/config.module.js';
import type { AppConfig } from '../../config/env.schema.js';
import { TransactionRunner } from '../../infrastructure/prisma/transaction-runner.js';
import { AuditService, type RequestMeta } from '../audit/audit.service.js';
import { AuthRepository, type LockoutPolicy } from './auth.repository.js';
import { PasswordHasher } from './password/password-hasher.js';
import {
  generateRefreshToken,
  hashRefreshToken,
  REFRESH_TOKEN_PATTERN,
  TokenService,
} from './token.service.js';
import { UnknownLoginLockout } from './unknown-login-lockout.js';

/** Lock muddati maksimumi (SECURITY §4): 24 soat. */
export const MAX_LOCKOUT_MS = 24 * 3_600_000;

export interface IssuedSession {
  response: LoginResponse;
  /** Faqat HttpOnly cookie'ga yoziladi — javob body'sida yo'q. */
  refreshToken: string;
  refreshExpiresAt: Date;
}

/** `423 ACCOUNT_LOCKED` + `Retry-After` uchun lock tugashigacha soniyalar. */
export class AccountLockedError extends AppError {
  constructor(readonly retryAfterSeconds: number) {
    super(ErrorCode.ACCOUNT_LOCKED);
  }
}

const secondsUntil = (until: Date, now: Date) =>
  Math.max(1, Math.ceil((until.getTime() - now.getTime()) / 1000));

/**
 * Autentifikatsiya use-case'lari (SECURITY §1–§4, API §3). HTTP'ni bilmaydi: cookie va header'lar
 * controller'da. Vaqt `Clock` orqali (testlarda boshqariladi).
 */
@Injectable()
export class AuthService {
  constructor(
    private readonly repository: AuthRepository,
    private readonly hasher: PasswordHasher,
    private readonly tokens: TokenService,
    private readonly unknownLogins: UnknownLoginLockout,
    private readonly fingerprint: LoginFingerprint,
    private readonly audit: AuditService,
    private readonly transactions: TransactionRunner,
    private readonly clock: Clock,
    @InjectConfig() private readonly config: AppConfig,
  ) {}

  private get lockoutPolicy(): LockoutPolicy {
    return {
      maxAttempts: this.config.AUTH_MAX_FAILED_ATTEMPTS,
      baseMs: this.config.AUTH_LOCKOUT_MINUTES * 60_000,
      maxMs: MAX_LOCKOUT_MS,
    };
  }

  /**
   * Login (API §3, SECURITY §1, §4). Javoblar:
   * - parol noto'g'ri YOKI login yo'q → bir xil `401 INVALID_CREDENTIALS` (ikkalasida ham argon2 tekshiruvi);
   * - lock (mavjud yoki mavjud bo'lmagan login uchun bir xil) → `423 ACCOUNT_LOCKED` + Retry-After;
   * - to'g'ri parol, lekin user BLOCKED → `403 ACCOUNT_BLOCKED` (parolni bilgan uchungina oshkor bo'ladi).
   */
  async login(input: LoginRequest, meta: RequestMeta): Promise<IssuedSession> {
    const now = this.clock.now();
    const candidate = await this.repository.findLoginCandidate(input.login);

    if (!candidate) {
      const lockedUntil = await this.unknownLogins.lockedUntil(input.login, now);
      if (lockedUntil) throw await this.rejectLocked(input.login, null, lockedUntil, now, meta);
      await this.hasher.verifyAgainstDummy(input.password);
      const failure = await this.unknownLogins.registerFailure(
        input.login,
        now,
        this.lockoutPolicy,
      );
      await this.audit.record({
        actorId: null,
        action: AuditAction.AUTH_LOGIN_FAILED,
        entityType: AuditEntityType.SESSION,
        // SEC-01: kiritilgan qiymat parol bo'lishi mumkin — xom holda emas (SECURITY §15.1).
        metadata: {
          ...this.fingerprint.metadata(input.login),
          reason: 'INVALID_CREDENTIALS',
          knownUser: false,
        },
        meta,
      });
      if (failure.justLocked) {
        await this.audit.record({
          actorId: null,
          action: AuditAction.AUTH_ACCOUNT_LOCKED,
          entityType: AuditEntityType.SESSION,
          metadata: {
            ...this.fingerprint.metadata(input.login),
            knownUser: false,
            lockedUntil: failure.lockedUntil?.toISOString(),
          },
          meta,
        });
      }
      if (failure.lockedUntil && (failure.justLocked || failure.alreadyLocked)) {
        throw new AccountLockedError(secondsUntil(failure.lockedUntil, now));
      }
      throw new AppError(ErrorCode.INVALID_CREDENTIALS);
    }

    if (candidate.lockedUntil && candidate.lockedUntil > now) {
      throw await this.rejectLocked(input.login, candidate.id, candidate.lockedUntil, now, meta);
    }

    const valid = await this.hasher.verify(candidate.passwordHash, input.password);

    if (!valid) {
      const failure = await this.transactions.run(async (tx) => {
        const result = await this.repository.registerFailure(
          tx,
          candidate.id,
          now,
          this.lockoutPolicy,
        );
        await this.audit.record(
          {
            actorId: null,
            action: AuditAction.AUTH_LOGIN_FAILED,
            entityType: AuditEntityType.SESSION,
            metadata: { login: input.login, reason: 'INVALID_CREDENTIALS', userId: candidate.id },
            meta,
          },
          tx,
        );
        if (result.justLocked) {
          await this.audit.record(
            {
              actorId: null,
              action: AuditAction.AUTH_ACCOUNT_LOCKED,
              entityType: AuditEntityType.USER,
              entityId: candidate.id,
              metadata: {
                login: candidate.login,
                lockoutCount: result.lockoutCount,
                lockedUntil: result.lockedUntil?.toISOString(),
              },
              meta,
            },
            tx,
          );
        }
        return result;
      });
      if (failure.lockedUntil && (failure.justLocked || failure.alreadyLocked)) {
        throw new AccountLockedError(secondsUntil(failure.lockedUntil, now));
      }
      throw new AppError(ErrorCode.INVALID_CREDENTIALS);
    }

    if (candidate.status !== 'ACTIVE') {
      await this.audit.record({
        actorId: null,
        action: AuditAction.AUTH_LOGIN_FAILED,
        entityType: AuditEntityType.SESSION,
        metadata: { login: candidate.login, reason: 'ACCOUNT_BLOCKED', userId: candidate.id },
        meta,
      });
      throw new AppError(ErrorCode.ACCOUNT_BLOCKED, { status: 403 });
    }

    // Pepper rotation: eski versiyadagi hash — tranzaksiyadan oldin (argon2 ~200 ms) hisoblanadi.
    const upgradedHash = this.hasher.needsRehash(candidate.passwordHash)
      ? await this.hasher.hash(input.password)
      : null;
    const refreshToken = generateRefreshToken();
    const refreshExpiresAt = new Date(
      now.getTime() + this.config.REFRESH_TOKEN_TTL_DAYS * 86_400_000,
    );
    const user = await this.transactions.run(async (tx) => {
      // Shartli: parallel xato urinish shu orada lock qilgan bo'lsa — to'g'ri parol ham o'tmaydi.
      if (!(await this.repository.registerSuccess(tx, candidate.id, now))) return null;
      if (upgradedHash) {
        await this.repository.upgradePasswordHash(
          tx,
          candidate.id,
          candidate.passwordHash,
          upgradedHash,
        );
      }
      const session = await this.repository.createSession(tx, {
        userId: candidate.id,
        tokenHash: hashRefreshToken(refreshToken),
        expiresAt: refreshExpiresAt,
        now,
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
      await this.audit.record(
        {
          actorId: candidate.id,
          action: AuditAction.AUTH_LOGIN_SUCCEEDED,
          entityType: AuditEntityType.SESSION,
          entityId: session.id,
          metadata: { login: candidate.login },
          meta,
        },
        tx,
      );
      return this.repository.loadCurrentUser(candidate.id, tx);
    });
    if (!user) throw new AccountLockedError(1);

    return { response: await this.buildResponse(user, now), refreshToken, refreshExpiresAt };
  }

  /**
   * Refresh (SECURITY §3): rotation + reuse detection. Sessiya qatori `FOR UPDATE` bilan olinadi —
   * parallel refresh'lardan faqat bittasi rotate qiladi, ikkinchisi qayta ishlatish deb aniqlanadi.
   */
  async refresh(refreshToken: string | undefined, meta: RequestMeta): Promise<IssuedSession> {
    if (!refreshToken || !REFRESH_TOKEN_PATTERN.test(refreshToken)) {
      throw new AppError(ErrorCode.SESSION_EXPIRED);
    }
    const now = this.clock.now();
    const nextToken = generateRefreshToken();
    const nextExpiresAt = new Date(now.getTime() + this.config.REFRESH_TOKEN_TTL_DAYS * 86_400_000);

    const outcome = await this.transactions.run(async (tx) => {
      const session = await this.repository.lockSessionByTokenHash(
        tx,
        hashRefreshToken(refreshToken),
      );
      if (!session) return { kind: 'invalid' as const };

      if (session.revokedAt) {
        if (session.revokedReason !== 'ROTATED') return { kind: 'invalid' as const };
        // Allaqachon almashtirilgan token qayta keldi — o'g'irlangan bo'lishi mumkin: butun family yopiladi.
        const revoked = await this.repository.revokeFamily(tx, session.familyId, now);
        await this.audit.record(
          {
            actorId: session.userId,
            action: AuditAction.AUTH_REFRESH_REUSE_DETECTED,
            entityType: AuditEntityType.SESSION,
            entityId: session.id,
            metadata: { familyId: session.familyId, revokedSessions: revoked },
            meta,
          },
          tx,
        );
        return { kind: 'reused' as const };
      }

      if (session.expiresAt <= now) return { kind: 'invalid' as const };

      const user = await this.repository.findAuthUser(session.userId);
      if (!user || user.status !== 'ACTIVE') {
        await this.repository.revokeSession(tx, session.id, 'USER_BLOCKED', now);
        return { kind: 'blocked' as const };
      }

      const next = await this.repository.createSession(tx, {
        userId: session.userId,
        tokenHash: hashRefreshToken(nextToken),
        familyId: session.familyId,
        expiresAt: nextExpiresAt,
        now,
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
      await this.repository.revokeSession(tx, session.id, 'ROTATED', now, next.id);
      const current = await this.repository.loadCurrentUser(session.userId, tx);
      return { kind: 'ok' as const, user: current! };
    });

    if (outcome.kind === 'blocked') throw new AppError(ErrorCode.ACCOUNT_BLOCKED);
    if (outcome.kind !== 'ok') throw new AppError(ErrorCode.SESSION_EXPIRED);
    return {
      response: await this.buildResponse(outcome.user, now),
      refreshToken: nextToken,
      refreshExpiresAt: nextExpiresAt,
    };
  }

  /** Logout: cookie'dagi sessiya yopiladi (idempotent — sessiya yo'q bo'lsa ham xato emas). */
  async logout(refreshToken: string | undefined, meta: RequestMeta): Promise<void> {
    if (!refreshToken || !REFRESH_TOKEN_PATTERN.test(refreshToken)) return;
    const now = this.clock.now();
    await this.transactions.run(async (tx) => {
      const session = await this.repository.revokeByTokenHash(
        tx,
        hashRefreshToken(refreshToken),
        now,
      );
      if (!session) return;
      await this.audit.record(
        {
          actorId: session.userId,
          action: AuditAction.AUTH_LOGOUT,
          entityType: AuditEntityType.SESSION,
          entityId: session.id,
          meta,
        },
        tx,
      );
    });
  }

  async me(userId: string): Promise<CurrentUser> {
    const user = await this.repository.loadCurrentUser(userId);
    if (!user) throw new AppError(ErrorCode.UNAUTHENTICATED);
    return user;
  }

  private async buildResponse(user: CurrentUser, now: Date): Promise<LoginResponse> {
    return {
      accessToken: await this.tokens.signAccessToken({ userId: user.id, role: user.role }, now),
      expiresIn: this.tokens.accessTtlSeconds,
      user,
    };
  }

  /** Lock vaqtidagi urinish: hisoblanmaydi, parol tekshirilmaydi; audit — muvaffaqiyatsiz login. */
  private async rejectLocked(
    login: string,
    userId: string | null,
    lockedUntil: Date,
    now: Date,
    meta: RequestMeta,
  ): Promise<AccountLockedError> {
    await this.audit.record({
      actorId: null,
      action: AuditAction.AUTH_LOGIN_FAILED,
      entityType: AuditEntityType.SESSION,
      metadata: {
        ...(userId ? { login, userId } : { ...this.fingerprint.metadata(login), knownUser: false }),
        reason: 'ACCOUNT_LOCKED',
      },
      meta,
    });
    return new AccountLockedError(secondsUntil(lockedUntil, now));
  }
}
