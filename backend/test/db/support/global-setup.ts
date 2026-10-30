import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { GenericContainer, type StartedTestContainer } from 'testcontainers';
import type { TestProject } from 'vitest/node';

declare module 'vitest' {
  export interface ProvidedContext {
    /** Migratsiya va seed qo'llangan test DB (superuser — trigger va huquqlarni sinash uchun). */
    databaseUrl: string;
    /** Haqiqiy Redis 8 (rate limit, noma'lum login lockout) — auth integration testlari uchun. */
    redisUrl: string;
  }
}

const backendDir = fileURLToPath(new URL('../../../', import.meta.url));

/** Prisma CLI'ni test DB'ga qarshi ishga tushiradi (root .env'dagi DATABASE_URL'ni almashtiradi). */
export function runPrisma(databaseUrl: string, args: string[]): string {
  return execFileSync('pnpm', ['exec', 'prisma', ...args], {
    cwd: backendDir,
    env: { ...process.env, DATABASE_URL: databaseUrl, MIGRATION_DATABASE_URL: '' },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

/** Migratsiya + seed (production bilan bir xil yo'l) — global DB va alohida DB'lar uchun. */
export function migrateAndSeed(databaseUrl: string): void {
  runPrisma(databaseUrl, ['migrate', 'deploy']);
  execFileSync('pnpm', ['db:seed'], {
    cwd: backendDir,
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

/**
 * Toza PostgreSQL 18 konteyneri → `prisma migrate deploy` → `db:seed`, hamda Redis 8.
 * Image'lar docker-compose.yml dagi bilan bir xil (`postgres:18-alpine`, `redis:8-alpine`).
 */
export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const [postgres, redis]: [StartedPostgreSqlContainer, StartedTestContainer] = await Promise.all([
    new PostgreSqlContainer('postgres:18-alpine')
      .withDatabase('divine_test')
      .withUsername('divine')
      .withPassword('divine_test_password')
      .start(),
    new GenericContainer('redis:8-alpine').withExposedPorts(6379).start(),
  ]);
  const databaseUrl = postgres.getConnectionUri();
  migrateAndSeed(databaseUrl);

  project.provide('databaseUrl', databaseUrl);
  project.provide('redisUrl', `redis://${redis.getHost()}:${redis.getMappedPort(6379)}`);

  return async () => {
    await Promise.all([postgres.stop(), redis.stop()]);
  };
}
