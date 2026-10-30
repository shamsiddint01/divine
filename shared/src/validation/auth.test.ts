import { beforeAll, describe, expect, it } from 'vitest';
import { loginRequestSchema } from './auth.js';
import { configureZodUzbek } from './error-map.js';
import { VALIDATION_MESSAGES_UZ as M } from './messages.uz.js';

beforeAll(() => configureZodUzbek());

const messages = (input: unknown) =>
  loginRequestSchema
    .safeParse(input)
    .error?.issues.map((i) => `${i.path.join('.')}:${i.message}`) ?? [];

// `POST /auth/login` (API §3, BR-03, BR-04): frontend formasi va backend bir xil sxema.
describe('loginRequestSchema', () => {
  it('to‘g‘ri login va 6 xonali parol qabul qilinadi', () => {
    expect(loginRequestSchema.safeParse({ login: 'Kassir01', password: '012345' }).success).toBe(
      true,
    );
  });

  it('bo‘sh maydonlar — aniq o‘zbekcha xabar', () => {
    expect(messages({ login: '', password: '' })).toEqual([
      `login:${M.loginRequired}`,
      `password:${M.passwordRequired}`,
    ]);
    expect(messages({})).toEqual([`login:${M.loginRequired}`, `password:${M.passwordRequired}`]);
  });

  it('login formati (harf + raqam) va parol formati (aynan 6 raqam)', () => {
    expect(messages({ login: 'kas sir', password: '12345' })).toEqual([
      `login:${M.loginFormat}`,
      `password:${M.passwordFormat}`,
    ]);
    expect(messages({ login: 'kassir', password: '1234567' })).toEqual([
      `password:${M.passwordFormat}`,
    ]);
  });

  it('noma’lum maydonlar rad etiladi', () => {
    expect(messages({ login: 'kassir', password: '123456', role: 'ADMIN' })).toEqual([
      `:${M.unknownFields}`,
    ]);
  });
});
