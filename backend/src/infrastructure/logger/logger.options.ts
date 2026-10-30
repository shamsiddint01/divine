import type { IncomingMessage, ServerResponse } from 'node:http';
import type { DestinationStream } from 'pino';
import type { Params } from 'nestjs-pino';
import { resolveRequestId } from '../../common/http/request-id.js';
import type { AppConfig } from '../../config/env.schema.js';

/**
 * Log'larga hech qachon tushmasligi kerak bo'lgan maydonlar (REQ-026, REQ-163, SECURITY §14).
 * pino-http so'rov body'sini umuman log qilmaydi va header'larni serializer'da tashlab yuboradi;
 * bu ro'yxat — qo'shimcha himoya (xato obyektlari yoki qo'lda yozilgan log kontekstlari uchun).
 */
const SENSITIVE_KEYS = [
  'password',
  'generatedPassword',
  'passwordHash',
  'password_hash',
  'pepper',
  'token',
  'accessToken',
  'refreshToken',
  'refresh_token',
  'tokenHash',
  'token_hash',
  'jwt',
  'secret',
  'authorization',
  'cookie',
  'cookies',
] as const;

export const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
  ...SENSITIVE_KEYS.flatMap((key) => [key, `*.${key}`, `*.*.${key}`]),
];

const HEALTH_PATH = '/api/v1/health';

/** URL'dan query string olib tashlanadi: qidiruv matnlari (masalan, mijoz telefoni) log'ga tushmasin. */
export function pathWithoutQuery(url: string | undefined): string | undefined {
  if (!url) return url;
  const index = url.indexOf('?');
  return index === -1 ? url : url.slice(0, index);
}

type RequestWithRoute = IncomingMessage & { route?: { path?: unknown } };

function withRoute(
  req: IncomingMessage,
  res: ServerResponse,
  value: Record<string, unknown>,
): Record<string, unknown> {
  const route = (req as RequestWithRoute).route?.path;
  return typeof route === 'string' && res.statusCode !== 404 ? { ...value, route } : value;
}

/**
 * pino-http sozlamalari. Har bir so'rov yakunida bitta yozuv:
 * `req.id` (requestId), `req.method`, `req.url` (query'siz), `route` (shablon), `res.statusCode`, `responseTime` (ms).
 * Daraja: 5xx → error, 4xx → warn, qolganlari → info.
 *
 * @param stream Testlar uchun: log'larni xotirada ushlash.
 */
export function buildLoggerOptions(config: AppConfig, stream?: DestinationStream): Params {
  return {
    pinoHttp: {
      level: config.LOG_LEVEL,
      genReqId: resolveRequestId,
      redact: { paths: REDACT_PATHS, censor: '[YASHIRILGAN]' },
      // Health-check so'rovlari log'ni to'ldirib yubormasligi uchun.
      autoLogging: { ignore: (req) => req.url?.startsWith(HEALTH_PATH) ?? false },
      customLogLevel: (_req, res, err) =>
        err || res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info',
      // Route shabloni (masalan `/api/v1/products/:id`) — ID'lar bo'yicha guruhlash uchun. Faqat yakuniy
      // yozuvga qo'shiladi (customProps so'rov boshida ham chaqiriladi); 404 da route yo'q (catch-all).
      customSuccessObject: (req, res, value: Record<string, unknown>) => withRoute(req, res, value),
      customErrorObject: (req, res, _err, value: Record<string, unknown>) =>
        withRoute(req, res, value),
      serializers: {
        // Faqat kerakli maydonlar; header'lar (cookie, authorization) va body umuman yozilmaydi.
        req: (req: { id: string; method: string; url: string; remoteAddress?: string }) => ({
          id: req.id,
          method: req.method,
          url: pathWithoutQuery(req.url),
          remoteAddress: req.remoteAddress,
        }),
        res: (res: ServerResponse | { statusCode: number }) => ({ statusCode: res.statusCode }),
      },
      ...(stream
        ? { stream }
        : config.NODE_ENV === 'development'
          ? {
              transport: {
                target: 'pino-pretty',
                options: { singleLine: true, translateTime: 'SYS:HH:MM:ss' },
              },
            }
          : {}),
    },
  };
}
