import { describe, expect, it } from 'vitest';
import { InvalidConfigError, parseConfig } from '../../../src/config/env.schema.js';

const base = {
  DATABASE_URL: 'postgresql://divine:divine@localhost:5434/divine',
  REDIS_URL: 'redis://localhost:6381',
  JWT_ACCESS_SECRET: 'a'.repeat(40),
  PASSWORD_PEPPER: 'b'.repeat(40),
};

describe('parseConfig (env validatsiyasi)', () => {
  it('standart qiymatlarni beradi', () => {
    const config = parseConfig({ ...base });
    expect(config.NODE_ENV).toBe('development');
    expect(config.API_PORT).toBe(3000);
    expect(config.CORS_ORIGINS).toEqual(['http://localhost:5173']);
    expect(config.SWAGGER_ENABLED).toBe(true);
    expect(config.JWT_ACCESS_TTL_SECONDS).toBe(900);
  });

  it('bo‘sh qiymatli kalit (KEY=) berilmagan deb hisoblanadi', () => {
    const config = parseConfig({ ...base, SWAGGER_ENABLED: '', API_PORT: '' });
    expect(config.SWAGGER_ENABLED).toBe(true);
    expect(config.API_PORT).toBe(3000);
  });

  it('CORS_ORIGINS ni ro‘yxatga ajratadi va "*" ni rad etadi', () => {
    expect(
      parseConfig({ ...base, CORS_ORIGINS: 'https://a.uz, https://b.uz' }).CORS_ORIGINS,
    ).toEqual(['https://a.uz', 'https://b.uz']);
    expect(() => parseConfig({ ...base, CORS_ORIGINS: '*' })).toThrow(InvalidConfigError);
  });

  it('production’da Swagger standart holatda o‘chiq', () => {
    expect(parseConfig({ ...base, NODE_ENV: 'production' }).SWAGGER_ENABLED).toBe(false);
  });

  it('qisqa secretlarni rad etadi', () => {
    expect(() => parseConfig({ ...base, PASSWORD_PEPPER: 'short' })).toThrow(/PASSWORD_PEPPER/);
  });

  it('production’da namunaviy (change-me) secretlarni rad etadi', () => {
    expect(() =>
      parseConfig({
        ...base,
        NODE_ENV: 'production',
        JWT_ACCESS_SECRET: 'change-me-0123456789012345678901234567',
      }),
    ).toThrow(/JWT_ACCESS_SECRET/);
  });

  it('production’da JWT secret va pepper bir xil bo‘lishini rad etadi', () => {
    expect(() =>
      parseConfig({ ...base, NODE_ENV: 'production', PASSWORD_PEPPER: base.JWT_ACCESS_SECRET }),
    ).toThrow(/PASSWORD_PEPPER/);
  });

  it('PASSWORD_PEPPER_V2 (rotation): ixtiyoriy; V1 yoki JWT secret bilan bir xil, qisqa, prod namunaviy — rad', () => {
    expect(parseConfig({ ...base }).PASSWORD_PEPPER_V2).toBeUndefined();
    expect(parseConfig({ ...base, PASSWORD_PEPPER_V2: 'c'.repeat(40) }).PASSWORD_PEPPER_V2).toBe(
      'c'.repeat(40),
    );
    for (const value of [base.PASSWORD_PEPPER, base.JWT_ACCESS_SECRET, 'qisqa']) {
      expect(() => parseConfig({ ...base, PASSWORD_PEPPER_V2: value })).toThrow(
        /PASSWORD_PEPPER_V2/,
      );
    }
    expect(() =>
      parseConfig({
        ...base,
        NODE_ENV: 'production',
        PASSWORD_PEPPER_V2: 'change-me-0123456789012345678901234567',
      }),
    ).toThrow(/PASSWORD_PEPPER_V2/);
  });

  it('noto‘g‘ri DATABASE_URL protokolini rad etadi', () => {
    expect(() => parseConfig({ ...base, DATABASE_URL: 'mysql://x@y/z' })).toThrow(/DATABASE_URL/);
  });

  it('xato xabarida secret QIYMATLARI chiqmaydi (REQ-163)', () => {
    const leakedSecret = 'super-secret-value-that-must-not-leak';
    try {
      parseConfig({
        ...base,
        PASSWORD_PEPPER: leakedSecret.slice(0, 10),
        DATABASE_URL: leakedSecret,
      });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidConfigError);
      expect((error as Error).message).not.toContain(leakedSecret.slice(0, 10));
      expect((error as Error).message).not.toContain(leakedSecret);
    }
  });
});
