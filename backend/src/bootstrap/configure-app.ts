import type { NestExpressApplication } from '@nestjs/platform-express';
import { API_PREFIX, configureZodUzbek, IDEMPOTENCY_HEADER } from '@divine/shared';
import type { NextFunction, Request, Response } from 'express';
import helmet from 'helmet';
import { REQUEST_ID_HEADER, requestIdMiddleware } from '../common/http/request-id.js';
import type { AppConfig } from '../config/env.schema.js';
import { DOCS_PATH, setupSwagger } from './swagger.js';

/**
 * HTTP qatlamining umumiy sozlamalari. main.ts va e2e testlar AYNAN shu funksiyani ishlatadi —
 * shuning uchun testdagi ilova production bilan bir xil xavfsizlik sozlamalariga ega.
 */
/** Body hajmi chegarasi (API §1.4 → 413 PAYLOAD_TOO_LARGE; Nginx'da ham shu qiymat). */
export const BODY_LIMIT = '1mb';

export function configureApp(app: NestExpressApplication, config: AppConfig): void {
  // Barcha Zod xabarlari o'zbekcha (validatsiya pipe'i va shared sxemalar).
  configureZodUzbek();

  app.set('trust proxy', config.TRUST_PROXY);
  app.disable('x-powered-by');

  // So'rov ID'si hamma narsadan oldin (body-parser xatolari ham requestId bilan qaytsin).
  app.use(requestIdMiddleware);

  // REQ-164: secure headers. API faqat JSON qaytaradi — eng qattiq CSP.
  const apiHelmet = helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] },
    },
    crossOriginResourcePolicy: { policy: 'same-site' },
    hsts: config.NODE_ENV === 'production',
  });
  // Swagger UI inline skript/stillarga muhtoj — faqat /api/docs uchun yumshatilgan CSP.
  const docsHelmet = helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:'],
      },
    },
  });
  app.use((req: Request, res: Response, next: NextFunction) =>
    (req.path.startsWith(`/${DOCS_PATH}`) ? docsHelmet : apiHelmet)(req, res, next),
  );

  // API javoblari (shaxsiy ma'lumot, kelgan narxi, hisobotlar) brauzer yoki proxy keshiga yozilmaydi:
  // umumiy kassa kompyuterida diskdagi keshdan o'qib bo'lmasin (Phase 16, SECURITY §12). Swagger'dan tashqari.
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (!req.path.startsWith(`/${DOCS_PATH}`)) res.setHeader('Cache-Control', 'no-store');
    next();
  });

  app.enableCors({
    origin: config.CORS_ORIGINS,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      IDEMPOTENCY_HEADER,
      'X-Requested-With',
      REQUEST_ID_HEADER,
    ],
    exposedHeaders: [REQUEST_ID_HEADER, 'Retry-After'],
    maxAge: 600,
  });

  // API faqat JSON qabul qiladi; urlencoded ham bir xil chegara bilan (Nest standarti 100kb o'rniga).
  app.useBodyParser('json', { limit: BODY_LIMIT });
  app.useBodyParser('urlencoded', { limit: BODY_LIMIT, extended: false });

  app.setGlobalPrefix(API_PREFIX);
  app.enableShutdownHooks();

  if (config.SWAGGER_ENABLED) setupSwagger(app, config);
}
