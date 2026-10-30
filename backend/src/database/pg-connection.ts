import type { PoolConfig } from 'pg';

/**
 * PostgreSQL ulanish sozlamalari — ilova, seed va DB testlari uchun yagona manba.
 * `timezone=UTC`: timestamptz qiymatlari sessiya zonasiga bog'liq bo'lmasin (DATABASE.md §10).
 * Toshkent kuni chegaralari application qatlamida hisoblanadi (Asia/Tashkent → UTC oraliq).
 */
export function pgPoolConfig(connectionString: string): PoolConfig {
  return { connectionString, options: '-c timezone=UTC' };
}
