import { ERROR_MESSAGES_UZ, ErrorCode } from '@divine/shared';
import { describe, expect, it } from 'vitest';
import { errorCodeForStatus, httpStatusFor } from '../../../src/common/errors/error-status.js';

// Yagona xato strukturasi (REQ-143, API §2): har bir xato kodi — aniq HTTP status va o'zbekcha matn.
describe('xato kodi ↔ HTTP status', () => {
  it('katalogdagi har bir kod 4xx/5xx statusga va o‘zbekcha xabarga ega', () => {
    for (const code of Object.values(ErrorCode)) {
      const status = httpStatusFor(code);
      expect(status, code).toBeGreaterThanOrEqual(400);
      expect(status, code).toBeLessThan(600);
      expect(ERROR_MESSAGES_UZ[code], code).toMatch(/\S/);
    }
  });

  it('framework statuslari xato kodiga aylanadi; noma’lumlari 4xx → BAD_REQUEST, qolgani → INTERNAL', () => {
    expect(
      [400, 401, 403, 404, 405, 409, 413, 429, 503].map((status) => errorCodeForStatus(status)),
    ).toEqual([
      ErrorCode.BAD_REQUEST,
      ErrorCode.UNAUTHENTICATED,
      ErrorCode.FORBIDDEN,
      ErrorCode.NOT_FOUND,
      ErrorCode.NOT_FOUND,
      ErrorCode.CONFLICT,
      ErrorCode.PAYLOAD_TOO_LARGE,
      ErrorCode.RATE_LIMITED,
      ErrorCode.SERVICE_UNAVAILABLE,
    ]);
    expect(errorCodeForStatus(418)).toBe(ErrorCode.BAD_REQUEST);
    expect(errorCodeForStatus(502)).toBe(ErrorCode.INTERNAL_ERROR);
    expect(errorCodeForStatus(500)).toBe(ErrorCode.INTERNAL_ERROR);
  });
});
