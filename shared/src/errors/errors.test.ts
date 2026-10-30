import { describe, expect, it } from 'vitest';
import { ERROR_MESSAGES_UZ, ErrorCode, isApiErrorBody } from './index.js';

describe('ERROR_MESSAGES_UZ (REQ-143)', () => {
  it('har bir error kodi uchun bo‘sh bo‘lmagan o‘zbekcha xabar bor', () => {
    for (const code of Object.values(ErrorCode)) {
      expect(ERROR_MESSAGES_UZ[code], code).toBeTruthy();
    }
  });

  it('xabarlarda kirill harflari va texnik tafsilotlar yo‘q', () => {
    for (const message of Object.values(ERROR_MESSAGES_UZ)) {
      expect(message).not.toMatch(/[Ѐ-ӿ]/);
      expect(message).not.toMatch(/exception|stack|sql|null|undefined/i);
    }
  });
});

describe('isApiErrorBody', () => {
  it('to‘g‘ri strukturani taniydi', () => {
    expect(isApiErrorBody({ error: { code: 'NOT_FOUND', message: 'Ma’lumot topilmadi' } })).toBe(
      true,
    );
  });

  it.each([null, {}, { error: 'x' }, { error: { code: 1, message: 'x' } }])(
    'noto‘g‘ri strukturani rad etadi: %j',
    (value) => {
      expect(isApiErrorBody(value)).toBe(false);
    },
  );
});
