import pg from 'pg';
import { inject } from 'vitest';
import { migrateAndSeed } from './global-setup.js';

/**
 * Bir xil konteynerda alohida, toza DB (migratsiya + seed, userlarsiz). Global holatga bog'liq
 * testlar uchun (masalan, "faol ADMIN'lar soni", bootstrap): boshqa test fayllari aralashmaydi.
 */
export async function freshDatabase(prefix = 'fresh'): Promise<string> {
  const base = inject('databaseUrl');
  const name = `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
  const admin = new pg.Client({ connectionString: base });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${name}`);
  await admin.end();
  const url = new URL(base);
  url.pathname = `/${name}`;
  migrateAndSeed(url.toString());
  return url.toString();
}
