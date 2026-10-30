import 'reflect-metadata';
import { ALL_PERMISSIONS } from '@divine/shared';
import { describe, expect, it, vi } from 'vitest';
import type { AccessContext } from '../../../src/common/auth/access-context.js';
import { ManualClock } from '../../../src/common/time/clock.js';
import type { TransactionRunner } from '../../../src/infrastructure/prisma/transaction-runner.js';
import type { AuditService } from '../../../src/modules/audit/audit.service.js';
import type { PasswordHasher } from '../../../src/modules/auth/password/password-hasher.js';
import type { LockedUser, UsersRepository } from '../../../src/modules/users/users.repository.js';
import { UsersService } from '../../../src/modules/users/users.service.js';

const ctx: AccessContext = {
  userId: 'actor',
  login: 'bosh',
  role: 'ADMIN',
  permissions: new Set(ALL_PERMISSIONS),
  warehouseIds: new Set(),
  issuedAt: 0,
};
const meta = { ip: null, userAgent: null, requestId: null };

/**
 * BR-27 qarorlari DB'siz, aniq holatlarda (real PG'dagi poyga testi `users.db-spec.ts` da).
 * Repository soxta: faqat qaror uchun kerakli javoblar.
 */
function setup(target: Partial<LockedUser>, otherActiveAdmins: number) {
  const user: LockedUser = {
    id: 'target',
    login: 'boshqa',
    fullName: null,
    role: 'ADMIN',
    status: 'ACTIVE',
    lockedUntil: null,
    warehouseIds: [],
    ...target,
  };
  const repository = {
    lockActiveAdmins: vi.fn(async () => undefined),
    lockUser: vi.fn(async () => user),
    countActiveAdmins: vi.fn(async () => otherActiveAdmins),
    roleId: vi.fn(async () => 2),
    updateUser: vi.fn(async () => undefined),
    revokeAllSessions: vi.fn(async () => 0),
    findDto: vi.fn(async () => ({ id: user.id })),
  };
  const transactions = { run: (fn: (tx: unknown) => unknown) => fn({}) };
  const audit = { record: vi.fn(async () => undefined) };
  const service = new UsersService(
    repository as unknown as UsersRepository,
    transactions as unknown as TransactionRunner,
    audit as unknown as AuditService,
    { hash: async () => 'v1$hash' } as unknown as PasswordHasher,
    new ManualClock(new Date('2026-10-22T09:00:00Z')),
  );
  return { service, repository, audit };
}

describe('UsersService: oxirgi faol ADMIN va o‘zini o‘zgartirish (BR-27)', () => {
  it('oxirgi faol ADMIN’ni bloklash → 409 LAST_ACTIVE_ADMIN, hech narsa yozilmaydi', async () => {
    const { service, repository, audit } = setup({}, 0);
    await expect(service.setStatus(ctx, 'target', 'BLOCKED', meta)).rejects.toMatchObject({
      code: 'LAST_ACTIVE_ADMIN',
      status: 409,
    });
    expect(repository.lockActiveAdmins).toHaveBeenCalled();
    expect(repository.updateUser).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('oxirgi faol ADMIN’ni USER qilish → 409', async () => {
    const { service, repository } = setup({}, 0);
    await expect(service.update(ctx, 'target', { role: 'USER' }, meta)).rejects.toMatchObject({
      code: 'LAST_ACTIVE_ADMIN',
    });
    expect(repository.updateUser).not.toHaveBeenCalled();
  });

  it('boshqa faol ADMIN bo‘lsa — ruxsat; bloklanganda sessiyalar bekor qilinadi', async () => {
    const { service, repository, audit } = setup({}, 1);
    await service.setStatus(ctx, 'target', 'BLOCKED', meta);
    expect(repository.updateUser).toHaveBeenCalledWith({}, 'target', { status: 'BLOCKED' });
    expect(repository.revokeAllSessions).toHaveBeenCalledWith(
      {},
      'target',
      'USER_BLOCKED',
      expect.any(Date),
    );
    expect(audit.record).toHaveBeenCalledTimes(1);
  });

  it('bloklangan ADMIN’ni USER qilish faol adminlar sonini kamaytirmaydi — tekshiruvsiz ruxsat', async () => {
    const { service, repository } = setup({ status: 'BLOCKED' }, 0);
    await service.update(ctx, 'target', { role: 'USER' }, meta);
    expect(repository.countActiveAdmins).not.toHaveBeenCalled();
    expect(repository.updateUser).toHaveBeenCalled();
  });

  it('o‘zi ustida: holat va parol tiklash — DB’ga murojaatsiz 403; rol — 403', async () => {
    const { service, repository } = setup({ id: 'actor' }, 5);
    await expect(service.setStatus(ctx, 'actor', 'BLOCKED', meta)).rejects.toMatchObject({
      code: 'CANNOT_MODIFY_SELF',
      status: 403,
    });
    await expect(service.resetPassword(ctx, 'actor', meta)).rejects.toMatchObject({
      code: 'CANNOT_MODIFY_SELF',
    });
    expect(repository.lockUser).not.toHaveBeenCalled();
    await expect(service.update(ctx, 'actor', { role: 'USER' }, meta)).rejects.toMatchObject({
      code: 'CANNOT_MODIFY_SELF',
    });
  });

  it('holat o‘zgarmasa — yozuv va audit yo‘q (idempotent)', async () => {
    const { service, repository, audit } = setup({ role: 'USER', status: 'BLOCKED' }, 0);
    await service.setStatus(ctx, 'target', 'BLOCKED', meta);
    expect(repository.updateUser).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });
});
