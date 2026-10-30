import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadSecretFiles, SECRET_FILE_KEYS } from '../../../src/config/secret-files.js';

// Phase 17: production secretlari Docker secrets (fayl) orqali — `.env`, image va `docker inspect`
// env'ida emas. `<KEY>_FILE` → fayl mazmuni `<KEY>` ga.
const dir = mkdtempSync(join(tmpdir(), 'divine-secrets-'));
const file = (name: string, content: string) => {
  const path = join(dir, name);
  writeFileSync(path, content, { mode: 0o600 });
  return path;
};

describe('loadSecretFiles (*_FILE)', () => {
  it('fayl mazmuni o‘qiladi, oxirgi qator tugashi olib tashlanadi; *_FILE kaliti o‘chiriladi', () => {
    const env: NodeJS.ProcessEnv = {
      JWT_ACCESS_SECRET_FILE: file('jwt', 'jwt-secret-0123456789-abcdefghijklmnop\n'),
      DATABASE_URL_FILE: file('db', 'postgresql://divine_api:p%40ss@postgres:5432/divine\r\n'),
    };
    loadSecretFiles(env);
    expect(env.JWT_ACCESS_SECRET).toBe('jwt-secret-0123456789-abcdefghijklmnop');
    expect(env.DATABASE_URL).toBe('postgresql://divine_api:p%40ss@postgres:5432/divine');
    expect(env.JWT_ACCESS_SECRET_FILE).toBeUndefined();
  });

  it('qo‘llab-quvvatlanadigan kalitlar — faqat secret/ulanish qiymatlari', () => {
    expect([...SECRET_FILE_KEYS].sort()).toEqual(
      [
        'DATABASE_URL',
        'JWT_ACCESS_SECRET',
        'MIGRATION_DATABASE_URL',
        'PASSWORD_PEPPER',
        'PASSWORD_PEPPER_V2',
        'REDIS_URL',
      ].sort(),
    );
  });

  it('ham qiymat, ham fayl berilsa; fayl yo‘q yoki bo‘sh bo‘lsa — xato (xabarda qiymat yo‘q)', () => {
    const secret = 'pepper-qiymati-0123456789-abcdefghijklmn';
    const cases: [NodeJS.ProcessEnv, RegExp][] = [
      [{ PASSWORD_PEPPER: secret, PASSWORD_PEPPER_FILE: file('p', secret) }, /bir vaqtda/],
      [{ PASSWORD_PEPPER_FILE: join(dir, 'yoq') }, /o‘qib bo‘lmadi/],
      [{ PASSWORD_PEPPER_FILE: file('bosh', '\n') }, /bo‘sh/],
    ];
    for (const [env, pattern] of cases) {
      let message = '';
      try {
        loadSecretFiles(env);
      } catch (error) {
        message = (error as Error).message;
      }
      expect(message).toMatch(pattern);
      expect(message).toMatch(/PASSWORD_PEPPER/);
      expect(message).not.toContain(secret);
    }
  });

  it('*_FILE berilmasa — env o‘zgarmaydi', () => {
    const env: NodeJS.ProcessEnv = { JWT_ACCESS_SECRET: 'x'.repeat(40) };
    loadSecretFiles(env);
    expect(env).toEqual({ JWT_ACCESS_SECRET: 'x'.repeat(40) });
  });
});
