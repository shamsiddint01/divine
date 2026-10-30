import { z } from 'zod';
import type { CurrentUser } from '../types/index.js';
import { VALIDATION_MESSAGES_UZ as M } from './messages.uz.js';
import { generatedPasswordSchema, loginSchema } from './primitives.js';

/**
 * `POST /auth/login` body (API §3) — frontend login formasi va backend bir xil sxemani ishlatadi.
 * Bo'sh maydon uchun aniq xabar ("Loginni kiriting"), qolgan qoidalar — `loginSchema` (BR-03)
 * va 6 xonali parol formati (BR-04). Noma'lum maydonlar rad etiladi.
 */
export const loginRequestSchema = z.strictObject({
  login: z.string({ error: M.loginRequired }).min(1, { error: M.loginRequired }).pipe(loginSchema),
  password: z
    .string({ error: M.passwordRequired })
    .min(1, { error: M.passwordRequired })
    .pipe(generatedPasswordSchema),
});

export type LoginRequest = z.infer<typeof loginRequestSchema>;

/** `POST /auth/login` va `POST /auth/refresh` javobi. Refresh token faqat HttpOnly cookie'da. */
export interface LoginResponse {
  accessToken: string;
  /** Access token muddati, soniya. */
  expiresIn: number;
  user: CurrentUser;
}
