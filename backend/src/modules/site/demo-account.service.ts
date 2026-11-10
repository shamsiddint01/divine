import { Injectable } from '@nestjs/common';
import {
  AuditAction,
  AuditEntityType,
  DEMO_TRIAL_DAYS,
  DEMO_TRIAL_MINUTES,
  type DemoAccountDto,
  type DemoAccountInput,
  ErrorCode,
  RoleCode,
} from '@divine/shared';
import { AppError } from '../../common/errors/app-error.js';
import { Clock } from '../../common/time/clock.js';
import { InjectConfig } from '../../config/config.module.js';
import type { AppConfig } from '../../config/env.schema.js';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { TransactionRunner } from '../../infrastructure/prisma/transaction-runner.js';
import { AuditService } from '../audit/audit.service.js';
import { generatePassword, PasswordHasher } from '../auth/password/password-hasher.js';

const DAY_MS = 86_400_000;
const META = { ip: null, userAgent: 'superadmin', requestId: null };

/**
 * Demo saytda sinov hisobi ochish (bot chaqiradi, `x-control-token` bilan). Har kimga alohida ADMIN
 * hisob: login `demo<ariza raqami>`, parol 6 xonali, javobda bir marta. Hisob 7 kun va jami 1 soat
 * ishlaydi (`DemoUsageService`).
 */
@Injectable()
export class DemoAccountService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly transactions: TransactionRunner,
    private readonly hasher: PasswordHasher,
    private readonly audit: AuditService,
    private readonly clock: Clock,
    @InjectConfig() private readonly config: AppConfig,
  ) {}

  async create(input: DemoAccountInput): Promise<DemoAccountDto> {
    if (!this.config.DEMO_MODE) {
      throw new AppError(ErrorCode.FORBIDDEN, { message: 'Bu sayt demo rejimida emas' });
    }
    const login = `demo${input.ref}`;
    const password = generatePassword();
    const passwordHash = await this.hasher.hash(password);
    const now = this.clock.now();
    const expiresAt = new Date(now.getTime() + DEMO_TRIAL_DAYS * DAY_MS);

    await this.transactions.run(async (tx) => {
      const role = await tx.role.findUnique({
        where: { code: RoleCode.ADMIN },
        select: { id: true },
      });
      if (!role) throw new AppError(ErrorCode.NOT_FOUND);
      if (await tx.user.findFirst({ where: { login: { equals: login, mode: 'insensitive' } } })) {
        throw new AppError(ErrorCode.LOGIN_TAKEN);
      }
      const user = await tx.user.create({
        data: {
          login,
          fullName: input.name,
          roleId: role.id,
          passwordHash,
          passwordChangedAt: now,
        },
        select: { id: true },
      });
      await tx.demoAccount.create({ data: { userId: user.id, expiresAt } });
      await this.audit.record(
        {
          actorId: null,
          action: AuditAction.DEMO_ACCOUNT_CREATED,
          entityType: AuditEntityType.USER,
          entityId: user.id,
          metadata: { login, expiresAt: expiresAt.toISOString() },
          meta: META,
        },
        tx,
      );
    });
    return { login, password, expiresAt: expiresAt.toISOString(), minutes: DEMO_TRIAL_MINUTES };
  }
}
