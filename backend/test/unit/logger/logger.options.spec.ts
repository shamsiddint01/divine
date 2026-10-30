import { pino } from 'pino';
import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { REDACT_PATHS } from '../../../src/infrastructure/logger/logger.options.js';

function captureLog(payload: Record<string, unknown>): string {
  let output = '';
  const stream = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      output += chunk.toString();
      callback();
    },
  });
  pino({ redact: { paths: REDACT_PATHS, censor: '[YASHIRILGAN]' } }, stream).info(payload, 'test');
  return output;
}

describe('log redaction (REQ-026, REQ-163)', () => {
  it('parol va tokenlarni har qanday chuqurlikda yashiradi', () => {
    const output = captureLog({
      password: '123456',
      user: { generatedPassword: '654321', passwordHash: '$argon2id$...' },
      session: { tokens: { refreshToken: 'rt-secret', accessToken: 'at-secret' } },
      req: { headers: { authorization: 'Bearer abc.def', cookie: 'refresh=xyz' } },
    });
    for (const secret of [
      '123456',
      '654321',
      '$argon2id$',
      'rt-secret',
      'at-secret',
      'abc.def',
      'refresh=xyz',
    ]) {
      expect(output).not.toContain(secret);
    }
    expect(output).toContain('[YASHIRILGAN]');
  });
});
