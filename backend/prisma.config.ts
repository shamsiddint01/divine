// Prisma CLI konfiguratsiyasi (migrate, generate, studio, seed).
// Prisma 7 .env faylni avtomatik o'qimaydi — mahalliy ishlab chiqishda root .env yuklanadi
// (allaqachon o'rnatilgan env o'zgaruvchilari almashtirilmaydi).
import { existsSync, readFileSync } from 'node:fs';
import { defineConfig, env } from 'prisma/config';

const rootEnvFile = new URL('../.env', import.meta.url);
if (existsSync(rootEnvFile)) process.loadEnvFile(rootEnvFile);

// Production (Phase 17): ulanish URL'lari Docker secrets fayllaridan — `src/config/secret-files.ts` bilan
// bir xil qoida (`<KEY>_FILE`; xatoda qiymat chiqmaydi).
for (const key of ['MIGRATION_DATABASE_URL', 'DATABASE_URL'] as const) {
  const path = process.env[`${key}_FILE`];
  if (path && !process.env[key]) {
    process.env[key] = readFileSync(path, 'utf8').replace(/\r?\n$/, '');
  }
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    // `prisma migrate reset` / `migrate dev` dan keyin avtomatik ishga tushadi.
    seed: 'tsx src/database/seed.cli.ts',
  },
  datasource: {
    // Migratsiyalar sxema egasi (DDL huquqli) foydalanuvchi bilan bajariladi; berilmasa — DATABASE_URL
    // (dev'da bitta foydalanuvchi). Ilova runtime'i esa doim DATABASE_URL (`divine_app` a'zosi) bilan ishlaydi.
    url: process.env.MIGRATION_DATABASE_URL || env('DATABASE_URL'),
  },
});
