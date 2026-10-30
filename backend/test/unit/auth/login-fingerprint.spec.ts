import { createHash, createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { LoginFingerprint } from '../../../src/common/security/login-fingerprint.js';

const PEPPER = 'unit-test-pepper-0123456789-abcdefghijk';
const fingerprint = new LoginFingerprint(PEPPER);

describe('LoginFingerprint (SEC-01, SECURITY §15.1)', () => {
  it('parol shaklidagi qiymat (aynan 6 raqam) — faqat maska va uzunlik, iz ham yo‘q', () => {
    for (const value of ['000000', '582913', '999999']) {
      expect(fingerprint.metadata(value)).toEqual({ loginMasked: true, loginLength: 6 });
    }
  });

  it('boshqa qiymatlar — 128 bitli iz; parol shakliga yaqin, lekin boshqa qiymatlar ham shu yerda', () => {
    for (const value of ['12345', '1234567', '58291a', 'Kassir01', 'abc']) {
      const meta = fingerprint.metadata(value);
      expect(meta).toEqual({
        loginFingerprint: expect.stringMatching(/^[0-9a-f]{32}$/),
        loginLength: value.length,
      });
      expect(JSON.stringify(meta)).not.toContain(value);
    }
  });

  it('deterministik va katta-kichik harf farqsiz (login kabi, BR-03); har xil login — har xil iz', () => {
    expect(fingerprint.of('KassirA')).toBe(fingerprint.of('kassira'));
    expect(fingerprint.of('KassirA')).toBe(new LoginFingerprint(PEPPER).of('KASSIRA'));
    expect(fingerprint.of('kassira')).not.toBe(fingerprint.of('kassirb'));
    expect(fingerprint.of('kassira')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('kalitli: kalitsiz hash ham, pepper bilan to‘g‘ridan-to‘g‘ri HMAC ham emas (alohida kalit, HKDF)', () => {
    const value = 'kassira';
    const print = fingerprint.of(value);
    expect(print).not.toBe(createHash('sha256').update(value).digest('hex'));
    expect(print).not.toBe(createHmac('sha256', PEPPER).update(value).digest('hex'));
    expect(new LoginFingerprint(`${PEPPER}-boshqa`).of(value)).not.toBe(print);
  });

  it('qisqa yoki bo‘sh pepper rad etiladi; xato xabarida qiymat yo‘q', () => {
    expect(() => new LoginFingerprint('')).toThrow(/PASSWORD_PEPPER/);
    const short = 'qisqa-pepper';
    let message = '';
    try {
      new LoginFingerprint(short);
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toMatch(/PASSWORD_PEPPER/);
    expect(message).not.toContain(short);
  });
});
