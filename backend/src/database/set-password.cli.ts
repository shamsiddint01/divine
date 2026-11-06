/**
 * Foydalanuvchiga egasi tanlagan parolni qo'yish (masalan, birinchi ADMIN):
 *
 *   scripts/render/set-password.sh <login>
 *
 * Parol `NEW_PASSWORD` env orqali keladi va hech qayerga chiqarilmaydi. Format — login formasidagi bilan
 * bir xil (BR-04). Hisob blokdan chiqadi va barcha sessiyalar yopiladi.
 */
// `.env` yuklovchi BIRINCHI import bo'lishi shart (qarang: config/load-env-file.ts).
import '../config/load-env-file.js';
import {
  AuditAction,
  AuditEntityType,
  generatedPasswordSchema,
  normalizeLogin,
} from '@divine/shared';
import { PrismaPg } from '@prisma/adapter-pg';
import { parseBootstrapConfig } from '../config/env.schema.js';
import { PrismaClient } from '../generated/prisma/client.js';
import { PasswordHasher } from '../modules/auth/password/password-hasher.js';
import { pgPoolConfig } from './pg-connection.js';

function fail(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

const login = process.argv[2];
if (!login) fail('Login berilmagan');
const password = generatedPasswordSchema.safeParse(process.env.NEW_PASSWORD);
if (!password.success) fail('Parol aynan 6 ta raqam bo‘lishi kerak');

const config = parseBootstrapConfig();
const hasher = new PasswordHasher(config.PASSWORD_PEPPER, config.PASSWORD_PEPPER_V2);
const passwordHash = await hasher.hash(password.data);
const prisma = new PrismaClient({ adapter: new PrismaPg(pgPoolConfig(config.DATABASE_URL)) });

try {
  await prisma.$transaction(
    async (tx) => {
      const user = await tx.user.findUnique({ where: { login: normalizeLogin(login) } });
      if (!user) fail('Bunday login topilmadi');
      const now = new Date();
      await tx.user.update({
        where: { id: user.id },
        data: {
          passwordHash,
          passwordChangedAt: now,
          failedLoginAttempts: 0,
          lockoutCount: 0,
          lockedUntil: null,
        },
      });
      const { count } = await tx.userSession.updateMany({
        where: { userId: user.id, revokedAt: null },
        data: { revokedAt: now, revokedReason: 'PASSWORD_RESET' },
      });
      await tx.auditLog.create({
        data: {
          action: AuditAction.USER_PASSWORD_RESET,
          entityType: AuditEntityType.USER,
          entityId: user.id,
          metadata: { login: user.login, revokedSessions: count, cli: true },
        },
      });
    },
    { maxWait: 30_000, timeout: 60_000 },
  );
  process.stdout.write('Parol yangilandi.\n');
} finally {
  await prisma.$disconnect();
}
