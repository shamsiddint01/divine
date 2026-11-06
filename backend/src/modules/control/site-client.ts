import { Injectable, Logger } from '@nestjs/common';
import {
  ErrorCode,
  ERROR_MESSAGES_UZ,
  isApiErrorBody,
  type SiteLicenseInput,
} from '@divine/shared';
import { AppError } from '../../common/errors/app-error.js';
import { CONTROL_TOKEN_HEADER } from '../site/control-token.guard.js';

/** Bepul serverdagi sayt uxlab yotgan bo'lishi mumkin: uyg'onishiga vaqt beriladi. */
const SITE_TIMEOUT_MS = 75_000;

type Target = { apiUrl: string; apiToken: string };

/** Mijoz saytining `/site-control` API'si bilan aloqa. */
@Injectable()
export class SiteClient {
  private readonly logger = new Logger(SiteClient.name);

  private async call<T>(site: Target, method: string, path: string, body?: unknown): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`${site.apiUrl}/api/v1/site-control${path}`, {
        method,
        signal: AbortSignal.timeout(SITE_TIMEOUT_MS),
        headers: {
          [CONTROL_TOKEN_HEADER]: site.apiToken,
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch (error) {
      this.logger.warn(`Sayt javob bermadi: ${site.apiUrl}`);
      throw new AppError(ErrorCode.SERVICE_UNAVAILABLE, {
        message: 'Sayt javob bermadi, birozdan keyin qayta urinib ko‘ring',
        cause: error,
      });
    }
    const payload: unknown =
      response.status === 204 ? undefined : await response.json().catch(() => undefined);
    if (!response.ok) {
      throw new AppError(ErrorCode.FORBIDDEN, {
        message: isApiErrorBody(payload)
          ? payload.error.message
          : ERROR_MESSAGES_UZ.SERVICE_UNAVAILABLE,
      });
    }
    return payload as T;
  }

  setLicense(site: Target, license: SiteLicenseInput): Promise<void> {
    return this.call(site, 'PUT', '/license', license);
  }

  requestView(site: Target): Promise<{ id: string; expiresAt: string }> {
    return this.call(site, 'POST', '/access-requests');
  }

  verifyView(
    site: Target,
    id: string,
    code: string,
  ): Promise<{ token: string; expiresAt: string }> {
    return this.call(site, 'POST', `/access-requests/${id}/verify`, { code });
  }
}
