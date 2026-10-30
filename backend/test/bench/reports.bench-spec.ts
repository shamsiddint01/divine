/* eslint-disable no-console -- benchmark natijalari (jadval) konsolga chiqariladi */
import {
  REPORT_DEFINITIONS,
  REPORT_PATHS,
  REPORT_TYPES,
  type ReportType,
  visibleReportParts,
} from '@divine/shared';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Prisma } from '../../src/generated/prisma/client.js';
import {
  financeStatement,
  type ReportQuery,
  reportStatements,
} from '../../src/modules/reports/reports.repository.js';
import {
  type AuthTestApp,
  createAuthApp,
  createUser,
  login,
  uniqueIp,
} from '../db/support/auth-app.js';
import { closePool } from '../db/support/db.js';
import { type BenchMetric, machineEnvironment, writeBenchResult } from './support/results.js';
import { BENCH_DATASET, BENCH_SALES, seedSales1M } from './support/seed-1m.js';

/*
 * REQ-167 / A-L11: hisobotlar 1 mln sotuvda < 2 s. Seed (alohida Testcontainers DB'da):
 *   5 ombor, 10 guruh, 200 mahsulot, 30 sotuvchi, 100 000 mijoz;
 *   1 000 000 sotuv × 2 qator (2 mln sale_items, 2 mln SALE harakati), 365 kunga teng taqsimlangan;
 *   3 650 tasdiqlangan kirim × 3 qator, 20 000 xarajat.
 * Seed tezligi uchun trigger'lar faqat seed tranzaksiyasida o'chiriladi (`session_replication_role =
 * replica`, faqat shu vaqtinchalik konteyner); ma'lumotlar ular tekshiradigan qoidalarga mos yoziladi.
 */
const PASSWORD = '582913';
const NOW = new Date('2026-10-24T05:00:00.000Z'); // Toshkent: 2026-10-24 10:00
const MONTH = { dateFrom: '2026-10-01', dateTo: '2026-10-24' };
const YEAR = { dateFrom: '2025-10-24', dateTo: '2026-10-24' };
const BUDGET_MS = 2000;

let t: AuthTestApp;
let token: string;
let sampleWarehouse: string;
let sampleProduct: string;
const results: BenchMetric[] = [];

interface Plan {
  'Execution Time': number;
  'Planning Time': number;
}

async function explain(statement: Prisma.Sql): Promise<number> {
  const [row] = await t.prisma.$queryRaw<{ 'QUERY PLAN': Plan[] }[]>(
    Prisma.sql`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${statement}`,
  );
  const plan = row!['QUERY PLAN'][0]!;
  return plan['Execution Time'] + plan['Planning Time'];
}

/** HTTP so'rovi (guard, validatsiya, ikkala SQL, JSON) — 3 marta, mediana. */
async function http(path: string): Promise<number> {
  const times: number[] = [];
  for (let i = 0; i < 3; i++) {
    const start = performance.now();
    await request(t.app.getHttpServer())
      .get(`/api/v1${path}`)
      .set('X-Forwarded-For', uniqueIp())
      .set({ Authorization: `Bearer ${token}` })
      .expect(200);
    times.push(performance.now() - start);
  }
  return times.sort((a, b) => a - b)[1]!;
}

function query(type: ReportType, extra: Partial<ReportQuery>): ReportQuery {
  const [field, direction] = REPORT_DEFINITIONS[type].defaultSort.split(':') as [
    string,
    'asc' | 'desc',
  ];
  const dated = REPORT_DEFINITIONS[type].dated;
  return {
    page: 1,
    pageSize: 20,
    sort: { field, direction },
    ...extra,
    ...(dated ? {} : { dateFrom: undefined, dateTo: undefined }),
  };
}

beforeAll(async () => {
  t = await createAuthApp();
  t.clock.set(NOW);
  const admin = await createUser(t, { password: PASSWORD, role: 'ADMIN' });
  token = (await login(t, { login: admin.login, password: PASSWORD }).expect(200)).body
    .accessToken as string;
  const started = performance.now();
  ({ sampleWarehouse, sampleProduct } = await seedSales1M(admin.id));
  console.log(`Seed: ${Math.round((performance.now() - started) / 1000)} s`);
}, 1_800_000);

afterAll(async () => {
  if (results.length > 0) {
    const [pg] = await t.prisma.$queryRaw<{ version: string; shared_buffers: string }[]>`
      SELECT current_setting('server_version') AS version, current_setting('shared_buffers') AS shared_buffers`;
    const file = writeBenchResult({
      kind: 'reports',
      environment: machineEnvironment({
        postgres: `PostgreSQL ${pg!.version} (postgres:18-alpine, Testcontainers, shared_buffers = ${pg!.shared_buffers})`,
      }),
      dataset: { ...BENCH_DATASET },
      method:
        "SQL: repository'ning aynan o‘sha so‘rovlari, EXPLAIN (ANALYZE, BUFFERS) planning + execution (sahifa + yig‘ma + guruhlar); HTTP: in-process Nest ilovasi, supertest, 3 marta, mediana; sahifa 20 qator",
      budget: { planMs: BUDGET_MS, httpMs: BUDGET_MS },
      metrics: results,
    });
    console.log(`Natija: ${file}`);
  }
  console.table(
    results.map((r) => ({
      "So'rov": r.name,
      'EXPLAIN ANALYZE, ms': typeof r.planMs === 'number' ? Math.round(r.planMs) : '—',
      'HTTP mediana, ms': typeof r.httpMs === 'number' ? Math.round(r.httpMs) : '—',
    })),
  );
  await t?.close();
  await closePool();
});

describe(`hisobotlar ${BENCH_SALES.toLocaleString('en')} sotuvda (REQ-167: < ${BUDGET_MS} ms)`, () => {
  it('seed hajmi', async () => {
    const [row] = await t.prisma.$queryRaw<{ sales: number; items: number }[]>`
      SELECT (SELECT count(*)::int FROM sales) AS sales, (SELECT count(*)::int FROM sale_items) AS items`;
    expect(row!.sales).toBeGreaterThanOrEqual(BENCH_SALES);
    expect(row!.items).toBeGreaterThanOrEqual(2 * BENCH_SALES);
  });

  for (const type of REPORT_TYPES) {
    const { columns, summary } = visibleReportParts(REPORT_DEFINITIONS[type], true);
    for (const [label, range] of [
      ['oy', MONTH],
      ['366 kun', YEAR],
    ] as const) {
      if (!REPORT_DEFINITIONS[type].dated && label !== 'oy') continue;
      it(`${type} (${REPORT_DEFINITIONS[type].dated ? label : 'joriy'})`, async () => {
        const q = query(type, range);
        const sql = reportStatements(type, q, columns, summary);
        const planMs =
          (await explain(sql.page)) +
          (await explain(sql.summary)) +
          (REPORT_DEFINITIONS[type].grouped ? await explain(sql.groups) : 0);
        const params = new URLSearchParams(
          REPORT_DEFINITIONS[type].dated ? { ...range, pageSize: '20' } : { pageSize: '20' },
        );
        const httpMs = await http(`/reports/${REPORT_PATHS[type]}?${params}`);
        results.push({ name: `${type} — ${label}`, planMs, httpMs });
        expect.soft(planMs, `${type} ${label}: SQL`).toBeLessThan(BUDGET_MS);
        expect.soft(httpMs, `${type} ${label}: HTTP`).toBeLessThan(BUDGET_MS);
      });
    }
  }

  it('sotuvlar — 366 kun + ombor + mahsulot filtri', async () => {
    const type = 'sales';
    const { columns, summary } = visibleReportParts(REPORT_DEFINITIONS[type], true);
    const sql = reportStatements(
      type,
      query(type, { ...YEAR, warehouseId: sampleWarehouse, productId: sampleProduct }),
      columns,
      summary,
    );
    const planMs = (await explain(sql.page)) + (await explain(sql.summary));
    results.push({ name: 'sales — 366 kun, ombor + mahsulot', planMs });
    expect.soft(planMs).toBeLessThan(BUDGET_MS);
  });

  for (const [label, range] of [
    ['oy', MONTH],
    ['366 kun', YEAR],
  ] as const) {
    it(`finance-summary (${label})`, async () => {
      const planMs = await explain(financeStatement(range));
      const httpMs = await http(`/reports/finance-summary?${new URLSearchParams(range)}`);
      results.push({ name: `finance-summary — ${label}`, planMs, httpMs });
      expect.soft(planMs).toBeLessThan(BUDGET_MS);
      expect.soft(httpMs).toBeLessThan(BUDGET_MS);
    });
  }

  for (const path of [
    '/dashboard/summary',
    '/dashboard/sales-trend?days=30',
    '/dashboard/top-products?days=30',
  ]) {
    it(`dashboard: ${path}`, async () => {
      const httpMs = await http(path);
      results.push({ name: path, httpMs });
      expect.soft(httpMs).toBeLessThan(BUDGET_MS);
    });
  }
});
