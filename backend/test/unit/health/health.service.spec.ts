import { describe, expect, it } from 'vitest';
import { parseConfig } from '../../../src/config/env.schema.js';
import type { HealthRepository } from '../../../src/modules/health/health.repository.js';
import { HealthService } from '../../../src/modules/health/health.service.js';

const config = parseConfig(process.env);

function serviceWith(database: boolean, redis: boolean): HealthService {
  const repository = {
    pingDatabase: async () => database,
    pingRedis: async () => redis,
  } as unknown as HealthRepository;
  return new HealthService(repository, config);
}

describe('HealthService', () => {
  it('hammasi ishlasa — ok', async () => {
    const result = await serviceWith(true, true).check();
    expect(result.status).toBe('ok');
    expect(result.checks).toEqual({ database: 'up', redis: 'up' });
    expect(result.version).toBe(config.APP_VERSION);
    expect(Number.isNaN(Date.parse(result.timestamp))).toBe(false);
  });

  it.each([
    [false, true, { database: 'down', redis: 'up' }],
    [true, false, { database: 'up', redis: 'down' }],
    [false, false, { database: 'down', redis: 'down' }],
  ] as const)('db=%s redis=%s — degraded', async (db, redis, checks) => {
    const result = await serviceWith(db, redis).check();
    expect(result.status).toBe('degraded');
    expect(result.checks).toEqual(checks);
  });
});
