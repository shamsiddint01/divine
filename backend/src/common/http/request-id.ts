import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createParamDecorator, type ExecutionContext } from '@nestjs/common';

export const REQUEST_ID_HEADER = 'X-Request-Id';

/**
 * Kiruvchi `X-Request-Id` faqat shu formatda qabul qilinadi: 8–64 belgi, lotin harf, raqam, `-`.
 * Boshqa har qanday qiymat (bo'sh joy, boshqaruv belgilari, juda uzun satr) log injection yoki
 * header bo'lib yuborishga yo'l qo'ymaslik uchun rad etiladi va yangi UUID beriladi.
 */
export const REQUEST_ID_PATTERN = /^[A-Za-z0-9-]{8,64}$/;

type RequestWithId = IncomingMessage & { id?: unknown };

/**
 * So'rov ID'si: xavfsiz kelgan ID qayta ishlatiladi, aks holda yangi UUID; javobga header yoziladi.
 * Idempotent — `req.id` allaqachon berilgan bo'lsa (birinchi middleware), o'sha qaytariladi.
 * pino-http `genReqId` ham shuni ishlatadi, shuning uchun log, header va xato javobidagi ID bir xil.
 */
export function resolveRequestId(req: IncomingMessage, res: ServerResponse): string {
  const existing = (req as RequestWithId).id;
  if (typeof existing === 'string') return existing;
  const incoming = req.headers['x-request-id'];
  const id =
    typeof incoming === 'string' && REQUEST_ID_PATTERN.test(incoming) ? incoming : randomUUID();
  res.setHeader(REQUEST_ID_HEADER, id);
  (req as RequestWithId).id = id;
  return id;
}

/**
 * Eng birinchi Express middleware: ID body-parser'dan OLDIN beriladi, shuning uchun noto'g'ri JSON
 * yoki 413 kabi parser xatolarida ham `X-Request-Id` va `error.requestId` bo'ladi.
 */
export function requestIdMiddleware(
  req: IncomingMessage,
  res: ServerResponse,
  next: () => void,
): void {
  resolveRequestId(req, res);
  next();
}

/**
 * Controller'da joriy so'rov ID'si: `handler(@RequestId() requestId: string)`.
 * Audit yozuvlarining `request_id` ustuni uchun (Phase 5+).
 */
export const RequestId = createParamDecorator((_data: unknown, ctx: ExecutionContext): string => {
  const req = ctx.switchToHttp().getRequest<{ id?: unknown }>();
  return typeof req.id === 'string' ? req.id : '';
});
