import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import {
  ApiErrorBodyDto,
  GLOBAL_ERROR_RESPONSES,
  PaginationMetaDto,
} from '../common/swagger/api-schemas.js';
import type { AppConfig } from '../config/env.schema.js';

export const DOCS_PATH = 'api/docs';

/**
 * OpenAPI hujjati: UI — /api/docs, JSON — /api/docs/openapi.json.
 * Production'da standart holatda o'chirilgan (SWAGGER_ENABLED, SECURITY §12).
 * Umumiy sxemalar: `ApiErrorBodyDto` (API §1.3), `PaginationMetaDto` (API §1.2).
 */
export function setupSwagger(app: INestApplication, config: AppConfig): void {
  const document = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('Divine.uz API')
      .setDescription(
        'Divine.uz ERP REST API. To‘liq contract: docs/API.md. ' +
          'Barcha xatolar yagona strukturada: `{ error: { code, message, details?, requestId } }`; ' +
          'har bir javobda `X-Request-Id` header bor.',
      )
      .setVersion(config.APP_VERSION)
      .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }, 'access-token')
      .addGlobalResponse(...GLOBAL_ERROR_RESPONSES)
      .build(),
    { extraModels: [ApiErrorBodyDto, PaginationMetaDto] },
  );
  SwaggerModule.setup(DOCS_PATH, app, document, {
    jsonDocumentUrl: `${DOCS_PATH}/openapi.json`,
    customSiteTitle: 'Divine.uz API',
  });
}
