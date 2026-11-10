import { parseTrustProxy } from './trusted-proxies.js';
import { z } from 'zod';

const booleanString = z
  .enum(['true', 'false', '1', '0'])
  .transform((value) => value === 'true' || value === '1');

/** Secret: kamida `min` belgi. Production'da `.env.example`dagi namunaviy qiymatlar rad etiladi. */
const secret = (min: number) => z.string().min(min, `kamida ${min} belgi bo'lishi kerak`);

const PLACEHOLDER_PREFIX = 'change-me';

/**
 * Barcha env o'zgaruvchilari shu sxema orqali startup'da tekshiriladi.
 * Noto'g'ri konfiguratsiya bilan ilova umuman ishga tushmaydi (fail fast).
 */
export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    APP_VERSION: z.string().default('0.1.0'),
    /** Render o'zi beradi: saytda qaysi commit ishlayapti (superadmin panelida ko'rinadi). */
    RENDER_GIT_COMMIT: z.string().trim().min(7).optional(),

    API_HOST: z.string().min(1).default('0.0.0.0'),
    API_PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    /** Vergul bilan ajratilgan aniq originlar. `*` ruxsat etilmaydi (credentials ishlatiladi). */
    CORS_ORIGINS: z
      .string()
      .default('http://localhost:5173')
      .transform((value) =>
        value
          .split(',')
          .map((origin) => origin.trim())
          .filter(Boolean),
      )
      .refine((origins) => !origins.includes('*'), "CORS_ORIGINS'da '*' ishlatib bo'lmaydi"),
    /** Reverse proxy hop'lari soni (Nginx/Caddy ortida 1). Rate limit to'g'ri IP'ni ko'rishi uchun. */
    TRUST_PROXY: z
      .union([z.number().int().min(0).max(10), z.string().min(1)])
      .default(0)
      .transform(parseTrustProxy)
      .refine((value) => (typeof value === 'number' ? value <= 10 : value.length > 0), {
        message: "TRUST_PROXY: hop'lar soni (0–10) yoki proxy ro'yxati",
      }),

    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    SWAGGER_ENABLED: booleanString.optional(),

    DATABASE_URL: z
      .url('to‘g‘ri URL bo‘lishi kerak')
      .refine((url) => /^postgres(ql)?:\/\//.test(url), 'postgresql:// bilan boshlanishi kerak'),
    REDIS_URL: z
      .url('to‘g‘ri URL bo‘lishi kerak')
      .refine((url) => /^rediss?:\/\//.test(url), 'redis:// bilan boshlanishi kerak'),

    // Auth (Phase 4, SECURITY §1–§4)
    JWT_ACCESS_SECRET: secret(32),
    JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(900),
    /** Kirishdan keyin sessiya shu muddat turadi; refresh uzaytirmaydi (egasining qarori, 2026-11-06). */
    REFRESH_TOKEN_TTL_HOURS: z.coerce.number().int().min(1).max(2160).default(16),
    PASSWORD_PEPPER: secret(32),
    /** Pepper rotation (SECURITY §13): berilsa yangi hash'lar `v2$`, eskilari login'da qayta hash qilinadi. */
    PASSWORD_PEPPER_V2: secret(32).optional(),
    AUTH_MAX_FAILED_ATTEMPTS: z.coerce.number().int().min(3).max(20).default(5),
    /** Birinchi lock muddati; har keyingi lock'da ikki baravar, maksimum 24 soat. */
    AUTH_LOCKOUT_MINUTES: z.coerce.number().int().min(1).max(1440).default(15),
    /**
     * Refresh cookie `Secure` atributi. Standart — true (brauzerlar http://localhost'da ham qabul qiladi).
     * Faqat dev'da, HTTPS'siz LAN manzil orqali sinashda `false`. Production'da `false` rad etiladi.
     */
    AUTH_COOKIE_SECURE: booleanString.default(true),

    /** Superadmin paneli API'si (`/control/*`): faqat egasining o'z serverida yoqiladi. */
    CONTROL_PANEL_ENABLED: booleanString.default(false),
    /** Panel shu saytni boshqaradigan kalit. Berilmasa — JWT_ACCESS_SECRET'dan hosil qilinadi. */
    CONTROL_API_TOKEN: secret(32).optional(),
    /** Superadmin kirishida Telegram kodi (2026-11-09 qayta yoqildi). `false` — vaqtincha o'chirish, eslatmalar ishlaydi. */
    CONTROL_TWO_FACTOR: booleanString.default(true),
    /**
     * Umumiy demo sayt (alohida deployment): sinov hisoblari vaqt bilan cheklanadi, foydalanuvchi
     * qo'shish/bloklash yopiq, `/site-control/demo-accounts` yoqiladi. Haqiqiy mijoz saytida — `false`.
     */
    DEMO_MODE: booleanString.default(false),
    /** Superadmin paneliga qo'shilgan demo sayt (`control_sites.id`): bot sinov hisobini shu yerda ochadi. */
    DEMO_SITE_ID: z.uuid().optional(),
    /** Ikkalasi berilsa: kunlik eslatmalar va (CONTROL_TWO_FACTOR bo'lsa) kirish kodi. */
    TELEGRAM_BOT_TOKEN: z.string().min(20).optional(),
    TELEGRAM_CHAT_ID: z
      .string()
      .regex(/^-?\d+$/)
      .optional(),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV !== 'production') return;
    if (!env.AUTH_COOKIE_SECURE) {
      ctx.addIssue({
        code: 'custom',
        path: ['AUTH_COOKIE_SECURE'],
        message: "production'da refresh cookie faqat Secure bo'lishi mumkin",
      });
    }
    for (const key of ['JWT_ACCESS_SECRET', 'PASSWORD_PEPPER', 'PASSWORD_PEPPER_V2'] as const) {
      if (env[key]?.startsWith(PLACEHOLDER_PREFIX)) {
        ctx.addIssue({
          code: 'custom',
          path: [key],
          message: "production'da namunaviy qiymat ishlatib bo'lmaydi",
        });
      }
    }
    if (env.JWT_ACCESS_SECRET === env.PASSWORD_PEPPER) {
      ctx.addIssue({
        code: 'custom',
        path: ['PASSWORD_PEPPER'],
        message: "JWT_ACCESS_SECRET bilan bir xil bo'lmasligi kerak",
      });
    }
  })
  .superRefine((env, ctx) => {
    // Har qanday muhitda: V2 — haqiqatan yangi pepper (V1 yoki JWT secret emas).
    if (
      env.PASSWORD_PEPPER_V2 !== undefined &&
      [env.PASSWORD_PEPPER, env.JWT_ACCESS_SECRET].includes(env.PASSWORD_PEPPER_V2)
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['PASSWORD_PEPPER_V2'],
        message: "PASSWORD_PEPPER va JWT_ACCESS_SECRET'dan farqli bo'lishi kerak",
      });
    }
  })
  .transform((env) => ({
    ...env,
    // Swagger standart holatda faqat production'dan tashqarida yoqiladi.
    SWAGGER_ENABLED: env.SWAGGER_ENABLED ?? env.NODE_ENV !== 'production',
  }));

export type AppConfig = z.infer<typeof envSchema>;

export class InvalidConfigError extends Error {
  constructor(public readonly problems: string[]) {
    super(`Konfiguratsiya xato:\n  - ${problems.join('\n  - ')}`);
    this.name = 'InvalidConfigError';
  }
}

/**
 * Env'ni tekshiradi va tiplangan konfiguratsiya qaytaradi.
 * Xato xabarida faqat kalit nomi va sabab bo'ladi — QIYMATLAR (secretlar) hech qachon chiqarilmaydi.
 */
export function parseConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  // `.env`dagi `KEY=` (bo'sh qiymat) — "berilmagan" deb hisoblanadi, standart qiymat ishlaydi.
  const defined = Object.fromEntries(Object.entries(env).filter(([, value]) => value !== ''));
  const result = envSchema.safeParse(defined);
  if (!result.success) {
    throw new InvalidConfigError(
      result.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`),
    );
  }
  return result.data;
}

/**
 * Admin bootstrap CLI uchun minimal konfiguratsiya: faqat DB va pepper (Redis, JWT shart emas).
 * Qoidalar ilova bilan bir xil: pepper ≥ 32 belgi, production'da namunaviy qiymat rad etiladi.
 */
const bootstrapEnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    DATABASE_URL: z
      .url('to‘g‘ri URL bo‘lishi kerak')
      .refine((url) => /^postgres(ql)?:\/\//.test(url), 'postgresql:// bilan boshlanishi kerak'),
    PASSWORD_PEPPER: secret(32),
    PASSWORD_PEPPER_V2: secret(32).optional(),
    SEED_ADMIN_LOGIN: z.string().optional(),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === 'production' && env.PASSWORD_PEPPER.startsWith(PLACEHOLDER_PREFIX)) {
      ctx.addIssue({
        code: 'custom',
        path: ['PASSWORD_PEPPER'],
        message: "production'da namunaviy qiymat ishlatib bo'lmaydi",
      });
    }
  });

export type BootstrapConfig = z.infer<typeof bootstrapEnvSchema>;

export function parseBootstrapConfig(env: NodeJS.ProcessEnv = process.env): BootstrapConfig {
  const defined = Object.fromEntries(Object.entries(env).filter(([, value]) => value !== ''));
  const result = bootstrapEnvSchema.safeParse(defined);
  if (!result.success) {
    throw new InvalidConfigError(
      result.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`),
    );
  }
  return result.data;
}
