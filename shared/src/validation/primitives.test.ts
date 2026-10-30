import { beforeAll, describe, expect, it } from 'vitest';
import { configureZodUzbek } from './error-map.js';
import { VALIDATION_MESSAGES_UZ as M } from './messages.uz.js';
import {
  customerNameSchema,
  dateRangeSchema,
  generatedPasswordSchema,
  isWholeQuantity,
  loginSchema,
  moneySchema,
  normalizeLogin,
  normalizeUzPhone,
  optionalBarcodeSchema,
  optionalPhoneSchema,
  positiveMoneySchema,
  quantitySchema,
} from './primitives.js';

beforeAll(() => configureZodUzbek());

const firstMessage = (result: { success: boolean; error?: { issues: { message: string }[] } }) =>
  result.error?.issues[0]?.message;

describe('loginSchema (BR-03, REQ-022)', () => {
  it.each(['ali', 'Ali2024', 'ADMIN', 'user01', 'a1b2c3', 'X'.repeat(32)])(
    'qabul qiladi: %s',
    (login) => {
      expect(loginSchema.safeParse(login).success).toBe(true);
    },
  );

  it.each([
    ['ali 1', 'probel'],
    [' ali', 'boshida probel'],
    ['ali ', 'oxirida probel'],
    ['ali_1', 'pastki chiziq'],
    ['ali-1', 'defis'],
    ['ali.1', 'nuqta'],
    ['alí', 'lotin bo‘lmagan diakritik'],
    ['али', 'kirill'],
    ['o‘g‘il', 'tutuq belgisi'],
    ['user@1', 'maxsus belgi'],
  ])('rad etadi: %s (%s)', (login) => {
    const result = loginSchema.safeParse(login);
    expect(result.success).toBe(false);
    expect(firstMessage(result)).toBe(M.loginFormat);
  });

  it('juda qisqa va juda uzun loginni rad etadi', () => {
    expect(firstMessage(loginSchema.safeParse('ab'))).toBe(M.loginTooShort);
    expect(firstMessage(loginSchema.safeParse('a'.repeat(33)))).toBe(M.loginTooLong);
  });

  it('yuborilmagan login uchun "Majburiy maydon" qaytaradi', () => {
    expect(firstMessage(loginSchema.safeParse(undefined))).toBe(M.required);
  });

  it('case-insensitive uniqueness uchun normallashtiradi (REQ-023)', () => {
    expect(normalizeLogin('AliVali')).toBe(normalizeLogin('alivali'));
  });
});

describe('generatedPasswordSchema (BR-04, REQ-024)', () => {
  it.each(['000000', '012345', '999999', '483920'])('qabul qiladi: %s', (password) => {
    expect(generatedPasswordSchema.safeParse(password).success).toBe(true);
  });

  it.each(['12345', '1234567', '12345a', 'abcdef', '12 345', ' 123456', '١٢٣٤٥٦'])(
    'rad etadi: %s',
    (password) => {
      const result = generatedPasswordSchema.safeParse(password);
      expect(result.success).toBe(false);
      expect(firstMessage(result)).toBe(M.passwordFormat);
    },
  );
});

describe('customerNameSchema (BR-05, REQ-074)', () => {
  it('ismni trim qiladi', () => {
    expect(customerNameSchema.parse('  Aziz  ')).toBe('Aziz');
  });

  it.each([undefined, null, '', '   '])('bo‘sh ismni rad etadi: %j', (value) => {
    const result = customerNameSchema.safeParse(value);
    expect(result.success).toBe(false);
    expect(firstMessage(result)).toBe(M.customerNameRequired);
  });
});

describe('telefon (BR-06, A-23)', () => {
  it.each([
    ['+998 90 123 45 67', '+998901234567'],
    ['998901234567', '+998901234567'],
    ['90 123-45-67', '+998901234567'],
    ['(90) 1234567', '+998901234567'],
  ])('normallashtiradi: %s → %s', (input, expected) => {
    expect(normalizeUzPhone(input)).toBe(expected);
  });

  it.each(['12345', '+7 999 123 45 67', '90123456a', '+99890123456789'])(
    'noto‘g‘ri raqamni rad etadi: %s',
    (input) => {
      expect(normalizeUzPhone(input)).toBeNull();
    },
  );

  it('ixtiyoriy: bo‘sh qiymat → undefined', () => {
    expect(optionalPhoneSchema.parse('')).toBeUndefined();
    expect(optionalPhoneSchema.parse('   ')).toBeUndefined();
    expect(optionalPhoneSchema.parse(undefined)).toBeUndefined();
    expect(optionalPhoneSchema.parse(null)).toBeUndefined();
  });

  it('ixtiyoriy, lekin berilsa format tekshiriladi', () => {
    const result = optionalPhoneSchema.safeParse('123');
    expect(result.success).toBe(false);
    expect(firstMessage(result)).toBe(M.phoneFormat);
  });
});

describe('pul va miqdor (REQ-133)', () => {
  it.each(['0', '12500', '12500.5', '12500.50', '9999999999999999.99'])(
    'moneySchema qabul qiladi: %s',
    (v) => expect(moneySchema.safeParse(v).success).toBe(true),
  );

  it.each(['-1', '1.234', 'abc', '1e5', '', '12 500'])('moneySchema rad etadi: %s', (v) => {
    expect(moneySchema.safeParse(v).success).toBe(false);
  });

  it('positiveMoneySchema nolni rad etadi', () => {
    expect(firstMessage(positiveMoneySchema.safeParse('0.00'))).toBe(M.moneyPositive);
  });

  it.each(['1', '0.5', '2.125', '100'])('quantitySchema qabul qiladi: %s', (v) => {
    expect(quantitySchema.safeParse(v).success).toBe(true);
  });

  it.each(['0', '0.000', '-1', '1.2345', 'x'])('quantitySchema rad etadi: %s', (v) => {
    expect(quantitySchema.safeParse(v).success).toBe(false);
  });

  it('butun miqdorni aniqlaydi (allow_decimal=false siyosati uchun)', () => {
    expect(isWholeQuantity('5')).toBe(true);
    expect(isWholeQuantity('5.000')).toBe(true);
    expect(isWholeQuantity('5.5')).toBe(false);
  });
});

describe('shtrix-kod (A-07)', () => {
  it('ixtiyoriy va trim qilinadi', () => {
    expect(optionalBarcodeSchema.parse('')).toBeUndefined();
    expect(optionalBarcodeSchema.parse(' 4780000000017 ')).toBe('4780000000017');
  });

  it('probelli shtrix-kodni rad etadi', () => {
    expect(optionalBarcodeSchema.safeParse('478 000').success).toBe(false);
  });
});

describe('dateRangeSchema (REQ-090)', () => {
  it('to‘g‘ri oraliqni qabul qiladi', () => {
    expect(dateRangeSchema.safeParse({ from: '2026-10-01', to: '2026-10-06' }).success).toBe(true);
  });

  it('teskari oraliqni rad etadi', () => {
    const result = dateRangeSchema.safeParse({ from: '2026-10-06', to: '2026-10-01' });
    expect(result.success).toBe(false);
    expect(firstMessage(result)).toBe(M.dateRangeOrder);
  });

  it('noto‘g‘ri sana formatini rad etadi', () => {
    expect(firstMessage(dateRangeSchema.safeParse({ from: '06.10.2026' }))).toBe(M.invalidDate);
  });
});
