import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { PrismaPg } from '@prisma/adapter-pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pgPoolConfig } from '../../src/database/pg-connection.js';
import { PrismaClient } from '../../src/generated/prisma/client.js';
import { bootstrapAdmin } from '../../src/modules/auth/bootstrap/bootstrap-admin.js';
import { PasswordHasher } from '../../src/modules/auth/password/password-hasher.js';
import { freshDatabase as freshDatabaseIn } from './support/fresh-database.js';

const PEPPER = 'bootstrap-test-pepper-0123456789-abcdefghij';
const backendDir = fileURLToPath(new URL('../../', import.meta.url));

const freshDatabase = () => freshDatabaseIn('bootstrap');

function runCli(databaseUrl: string, args: string[]) {
  return spawnSync('pnpm', ['exec', 'tsx', 'src/database/bootstrap-admin.cli.ts', ...args], {
    cwd: backendDir,
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl,
      PASSWORD_PEPPER: PEPPER,
      SEED_ADMIN_LOGIN: '',
    },
    encoding: 'utf8',
  });
}

describe('bootstrapAdmin (funksiya)', () => {
  let prisma: PrismaClient;
  const hasher = new PasswordHasher(PEPPER);

  beforeAll(async () => {
    prisma = new PrismaClient({ adapter: new PrismaPg(pgPoolConfig(await freshDatabase())) });
  }, 120_000);

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it('5 ta parallel ishga tushirish → aynan bitta ADMIN (advisory lock), qolganlari rad etiladi', async () => {
    const results = await Promise.all(
      ['rahbar', 'rahbar2', 'rahbar3', 'rahbar4', 'rahbar5'].map((login) =>
        bootstrapAdmin(prisma, hasher, { login, fullName: 'Bosh administrator' }),
      ),
    );
    const created = results.filter((r) => r.status === 'created');
    expect(created).toHaveLength(1);
    expect(results.filter((r) => r.status === 'admin_exists')).toHaveLength(4);
    expect(await prisma.user.count({ where: { role: { code: 'ADMIN' } } })).toBe(1);

    const result = created[0]!;
    if (result.status !== 'created') throw new Error('unreachable');
    expect(result.password).toMatch(/^\d{6}$/);
    const stored = await prisma.user.findUniqueOrThrow({ where: { id: result.userId } });
    // Faqat hash; to'g'ri parol bilan tekshiriladi.
    expect(stored.passwordHash).not.toContain(result.password);
    expect(await hasher.verify(stored.passwordHash, result.password)).toBe(true);
    expect(stored.createdById).toBeNull();

    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'USER_CREATED', entityId: result.userId },
    });
    expect(audit.metadata).toEqual({ login: result.login, role: 'ADMIN', bootstrap: true });
    expect(JSON.stringify(audit.metadata)).not.toContain(result.password);
  });

  it('takroriy ishga tushirish mavjud adminni o‘zgartirmaydi', async () => {
    const before = await prisma.user.findFirstOrThrow({ where: { role: { code: 'ADMIN' } } });
    expect(await bootstrapAdmin(prisma, hasher, { login: 'boshqa' })).toEqual({
      status: 'admin_exists',
    });
    const after = await prisma.user.findUniqueOrThrow({ where: { id: before.id } });
    expect(after.passwordHash).toBe(before.passwordHash);
  });
});

describe('db:bootstrap-admin CLI', () => {
  let databaseUrl: string;

  beforeAll(async () => {
    databaseUrl = await freshDatabase();
  }, 120_000);

  it('birinchi ishga tushirish: parol terminalda bir marta; hash va pepper chiqmaydi', () => {
    const run = runCli(databaseUrl, ['--login', 'Rahbar', '--full-name', 'Akmal Rahimov']);
    expect(run.status).toBe(0);
    const passwords = run.stdout.match(/\b\d{6}\b/g) ?? [];
    expect(passwords).toHaveLength(1);
    expect(run.stdout).toContain('Login: Rahbar');
    const output = run.stdout + run.stderr;
    expect(output).not.toMatch(/argon2|v1\$/);
    expect(output).not.toContain(PEPPER);
  }, 60_000);

  it('ikkinchi ishga tushirish: 3-kod bilan rad etiladi, parol ko‘rsatilmaydi', () => {
    const run = runCli(databaseUrl, ['--login', 'Ikkinchi']);
    expect(run.status).toBe(3);
    expect(run.stdout).not.toMatch(/\b\d{6}\b/);
    expect(run.stderr).toContain('administrator allaqachon mavjud');
  }, 60_000);

  it('noto‘g‘ri login → 2-kod; login berilmasa → 2-kod', () => {
    expect(runCli(databaseUrl, ['--login', 'ali vali']).status).toBe(2);
    expect(runCli(databaseUrl, []).status).toBe(2);
  }, 60_000);

  it('pepper berilmasa yoki qisqa bo‘lsa → 1-kod, qiymat chiqmaydi', () => {
    const run = spawnSync(
      'pnpm',
      ['exec', 'tsx', 'src/database/bootstrap-admin.cli.ts', '--login', 'x123'],
      {
        cwd: backendDir,
        env: { ...process.env, DATABASE_URL: databaseUrl, PASSWORD_PEPPER: 'qisqa-pepper' },
        encoding: 'utf8',
      },
    );
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('PASSWORD_PEPPER');
    expect(run.stderr).not.toContain('qisqa-pepper');
  }, 60_000);
});
