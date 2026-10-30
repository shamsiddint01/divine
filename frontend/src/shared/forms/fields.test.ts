import { VALIDATION_MESSAGES_UZ as M } from '@divine/shared';
import { describe, expect, it } from 'vitest';
import {
  groupDigits,
  moneyField,
  optionalQuantityField,
  positiveMoneyField,
  quantityField,
  toDecimal,
} from './fields';

const error = (
  schema: { safeParse: (v: unknown) => { error?: { issues: { message: string }[] } } },
  v: string,
) => schema.safeParse(v).error?.issues[0]?.message;

// Forma maydonlari: foydalanuvchi "1 250 000,50" kabi yozadi; tekshiruv — shared sxemalar (REQ-152).
describe('forma maydonlari', () => {
  it('pul: probel va vergul bilan qabul qilinadi; noto‘g‘ri va 0 — o‘zbekcha xabar', () => {
    expect(error(moneyField(), '1 250 000,50')).toBeUndefined();
    expect(error(moneyField(), '0')).toBeUndefined();
    expect(error(moneyField(), 'abc')).toBe(M.moneyFormat);
    expect(error(positiveMoneyField(), '0')).toBe(M.moneyPositive);
    expect(error(positiveMoneyField(), '12,5')).toBeUndefined();
  });

  it('miqdor: majburiy va ixtiyoriy', () => {
    expect(error(quantityField(), '2,5')).toBeUndefined();
    expect(error(quantityField(), '')).toBe(M.quantityFormat);
    expect(error(optionalQuantityField(), '  ')).toBeUndefined();
    expect(error(optionalQuantityField(), 'x')).toBe(M.quantityFormat);
  });

  it('kanonik ko‘rinish va guruhlash', () => {
    expect(toDecimal('1 250 000,50')).toBe('1250000.50');
    expect(toDecimal(' abc ')).toBe('abc');
    expect(groupDigits('1250000')).toBe('1 250 000');
    expect(groupDigits('1250000,5')).toBe('1 250 000,5');
    expect(groupDigits('x')).toBe('x');
  });
});
