import { beforeAll, describe, expect, it } from 'vitest';
import { configureZodUzbek } from './error-map.js';
import { VALIDATION_MESSAGES_UZ as M } from './messages.uz.js';
import { normalizeThreshold, settingsUpdateSchema } from './settings.js';

beforeAll(() => configureZodUzbek());

describe('sozlamalar (API §16, D-21)', () => {
  it('kam qoldiq chegarasi seed bilan bir xil ko‘rinishda', () => {
    expect(['5.500', '5.000', '0.250', '005', '0', '10'].map(normalizeThreshold)).toEqual([
      '5.5',
      '5',
      '0.25',
      '5',
      '0',
      '10',
    ]);
  });

  it('bo‘sh PATCH rad etiladi, qisman PATCH qabul qilinadi', () => {
    expect(settingsUpdateSchema.safeParse({}).error?.issues[0]?.message).toBe(M.updateEmpty);
    expect(settingsUpdateSchema.safeParse({ currencyLabel: 'so‘m' }).success).toBe(true);
  });
});
