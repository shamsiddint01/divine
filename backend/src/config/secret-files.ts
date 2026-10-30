import { readFileSync } from 'node:fs';

/**
 * Production secretlari fayl orqali (Docker secrets, Phase 17): `<KEY>_FILE=/run/secrets/...` berilsa,
 * fayl mazmuni `<KEY>` ga yuklanadi. Shunda secret `.env`da, image ichida va `docker inspect`dagi
 * env ro'yxatida bo'lmaydi. Xato xabarlarida faqat kalit nomi va fayl yo'li — qiymat hech qachon.
 */
export const SECRET_FILE_KEYS = [
  'DATABASE_URL',
  'MIGRATION_DATABASE_URL',
  'REDIS_URL',
  'JWT_ACCESS_SECRET',
  'PASSWORD_PEPPER',
  'PASSWORD_PEPPER_V2',
] as const;

export function loadSecretFiles(env: NodeJS.ProcessEnv = process.env): void {
  for (const key of SECRET_FILE_KEYS) {
    const path = env[`${key}_FILE`];
    if (!path) continue;
    if (env[key])
      throw new Error(`${key} va ${key}_FILE bir vaqtda berilgan — bittasini qoldiring`);
    let value: string;
    try {
      value = readFileSync(path, 'utf8').replace(/\r?\n$/, '');
    } catch {
      throw new Error(`${key}_FILE faylini o‘qib bo‘lmadi: ${path}`);
    }
    if (!value) throw new Error(`${key}_FILE fayli bo‘sh: ${path}`);
    env[key] = value;
    delete env[`${key}_FILE`];
  }
}
