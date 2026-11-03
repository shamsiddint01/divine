/* eslint-disable no-console -- yuklama natijalari (jadval) konsolga chiqariladi */
import { type ChildProcess, execFileSync, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { type AuthTestApp, createAuthApp, createUser } from '../db/support/auth-app.js';
import { closePool } from '../db/support/db.js';
import { type BenchMetric, machineEnvironment, writeBenchResult } from './support/results.js';
import { BENCH_DATASET, seedSales1M } from './support/seed-1m.js';

/*
 * REQ-167 / A-L11: oddiy API endpointlari yuklama ostida p95 < 300 ms (Phase 15, TESTING §5).
 *
 * Ma'lumot: hisobot benchmark'i bilan bir xil 1 mln sotuvli DB (`seed-1m.ts`). Yozuvlar (sotuv) uchun
 * alohida "Yuklama ombori" — API orqali: 20 mahsulot, tasdiqlangan kirim (har biri 100 000), 30
 * sotuvchiga biriktirilgan (ledger zanjiri trigger'lar bilan to'g'ri). Phase 17: sotuvchilar seed
 * omborlaridan biriga ham biriktiriladi — kassa katalogi (`sort=sold:desc`) bir yillik tarixli omborda ham
 * o'lchanadi (faqat o'qish).
 * Server: production build (swc), `NODE_ENV=production`, ALOHIDA Node jarayoni (yuklama generatori bilan
 * bir event loop'ni bo'lishmaydi), real soat, pino `info` (stdout tashlab yuboriladi), Redis throttler.
 * Mijozlar: 30 sotuvchi + 2 admin — har biri o'z tokeni va IP'si (`TRUST_PROXY=1`), yopiq sikl:
 * so'rov → javob to'liq o'qiladi → "o'ylash" pauzasi. Pauza per-user limitlardan (o'qish 600/daq,
 * yozish 120/daq) past turadi — haqiqiy kassir tezligi; 429 xato hisoblanadi.
 * Bosqichlar: qizdirish 15 s (o'lchanmaydi) → normal 60 s (pauza 250 ms) → peak 60 s (pauza 120 ms).
 * Kechikish — mijoz tomonida (`performance.now()`, fetch boshidan javob tanasi oxirigacha), lokal tarmoq.
 * Chegara: har bir endpoint va bosqich bo'yicha p95 < 300 ms; xatolar (non-2xx) — 0.
 * Hisobotlar (`/reports/*`) bu yerda emas — ular uchun alohida < 2 s chegara (`reports.bench-spec.ts`).
 */
const PASSWORD = '582913';
const P95_BUDGET_MS = 300;
const SECRETS = {
  // auth-app.ts bilan bir xil: seed'dagi parol hash'lari shu pepper bilan.
  JWT_ACCESS_SECRET: 'test-access-secret-0123456789-abcdefghij',
  PASSWORD_PEPPER: 'test-password-pepper-0123456789-abcdefghij',
};
const PHASES = [
  { name: 'qizdirish', seconds: 15, thinkMs: 250, measured: false },
  { name: 'normal', seconds: 60, thinkMs: 250, measured: true },
  { name: 'peak', seconds: 60, thinkMs: 120, measured: true },
] as const;
const LOAD_PRODUCTS = 20;
const SELLERS = 30;
const ADMINS = 2;

const backendDir = fileURLToPath(new URL('../../', import.meta.url));
const DIST = `${backendDir}node_modules/.cache/load-bench-dist`;
const PORT = 3400 + Math.floor(Math.random() * 400);
const API = `http://127.0.0.1:${PORT}/api/v1`;

interface Sample {
  phase: string;
  endpoint: string;
  ms: number;
  status: number;
}

let t: AuthTestApp;
let server: ChildProcess;
let loadWarehouse = '';
/** Seed omborlaridan biri (1 mln sotuvning ~1/5 qismi) — kassa katalogi uchun, faqat o'qish (Phase 17). */
let historyWarehouse = '';
const loadProducts: { id: string; barcode: string }[] = [];
const sellerTokens: string[] = [];
const adminTokens: string[] = [];
const samples: Sample[] = [];
const metrics: BenchMetric[] = [];
let ipSeq = 0;
const nextIp = () => `10.77.${Math.floor(++ipSeq / 250)}.${(ipSeq % 250) + 1}`;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function api<T>(
  method: string,
  path: string,
  opts: { token?: string; body?: unknown; ip?: string; headers?: Record<string, string> } = {},
): Promise<{ status: number; body: T }> {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      Accept: 'application/json',
      'X-Forwarded-For': opts.ip ?? nextIp(),
      ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
      ...opts.headers,
    },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  const text = await res.text();
  return { status: res.status, body: (text ? JSON.parse(text) : undefined) as T };
}

async function must<T>(method: string, path: string, opts: Parameters<typeof api>[2] = {}) {
  const res = await api<T>(method, path, opts);
  if (res.status >= 300)
    throw new Error(`${method} ${path} → ${res.status} ${JSON.stringify(res.body)}`);
  return res.body;
}

const loginAs = async (login: string) =>
  (
    await must<{ accessToken: string }>('POST', '/auth/login', {
      body: { login, password: PASSWORD },
    })
  ).accessToken;

const pick = <T>(items: readonly T[]) => items[Math.floor(Math.random() * items.length)]!;

/** Og'irlik bo'yicha amal: [og'irlik, endpoint yorlig'i, so'rov]. */
type Op = [
  number,
  string,
  () => { method: string; path: string; body?: unknown; headers?: Record<string, string> },
];

function sellerOps(): Op[] {
  const customer = () => `Bench mijoz ${1 + Math.floor(Math.random() * 100_000)}`;
  return [
    [
      20,
      'GET /products (kassa katalogi)',
      () => ({
        method: 'GET',
        path: `/products?warehouseId=${loadWarehouse}&status=ACTIVE&pageSize=24&sort=sold:desc`,
      }),
    ],
    // Phase 17: real do'kon holati — bir yillik tarixli ombor (~200 000 sotuv) kassa standart saralashi bilan.
    [
      10,
      'GET /products (kassa, tarixli ombor)',
      () => ({
        method: 'GET',
        path: `/products?warehouseId=${historyWarehouse}&status=ACTIVE&pageSize=24&sort=sold:desc`,
      }),
    ],
    [
      15,
      'GET /products?search',
      () => ({
        method: 'GET',
        path: `/products?warehouseId=${loadWarehouse}&search=${encodeURIComponent(`Yuklama ${1 + Math.floor(Math.random() * 9)}`)}&pageSize=24&sort=name:asc`,
      }),
    ],
    [
      10,
      'GET /products/lookup',
      () => ({
        method: 'GET',
        path: `/products/lookup?barcode=${pick(loadProducts).barcode}&warehouseId=${loadWarehouse}`,
      }),
    ],
    [
      10,
      'GET /customers?search',
      () => ({
        method: 'GET',
        path: `/customers?search=${encodeURIComponent(customer().slice(0, 14))}&pageSize=5&sort=lastPurchaseAt:desc`,
      }),
    ],
    [
      10,
      'POST /sales',
      () => {
        const [a, b] = [pick(loadProducts), pick(loadProducts)];
        return {
          method: 'POST',
          path: '/sales',
          headers: { 'Idempotency-Key': randomUUID() },
          body: {
            warehouseId: loadWarehouse,
            customer: { name: `Yuklama mijoz ${randomUUID().slice(0, 8)}`, phone: null },
            items:
              a.id === b.id
                ? [{ productId: a.id, quantity: '3' }]
                : [
                    { productId: a.id, quantity: '1' },
                    { productId: b.id, quantity: '2' },
                  ],
          },
        };
      },
    ],
    [
      10,
      'GET /sales (o‘z tarixi)',
      () => ({ method: 'GET', path: '/sales?page=1&pageSize=20&sort=soldAt:desc' }),
    ],
    [10, 'GET /dashboard/my-summary', () => ({ method: 'GET', path: '/dashboard/my-summary' })],
    [5, 'GET /auth/me', () => ({ method: 'GET', path: '/auth/me' })],
  ];
}

function adminOps(): Op[] {
  return [
    [15, 'GET /dashboard/summary', () => ({ method: 'GET', path: '/dashboard/summary' })],
    [
      15,
      'GET /sales (hammasi)',
      () => ({ method: 'GET', path: '/sales?page=1&pageSize=20&sort=soldAt:desc' }),
    ],
    [
      10,
      'GET /products (admin)',
      () => ({ method: 'GET', path: '/products?pageSize=20&sort=name:asc' }),
    ],
    [10, 'GET /warehouses', () => ({ method: 'GET', path: '/warehouses?pageSize=20' })],
    [
      10,
      'GET /warehouses/:id/stock',
      () => ({ method: 'GET', path: `/warehouses/${loadWarehouse}/stock?pageSize=20` }),
    ],
    [10, 'GET /expenses', () => ({ method: 'GET', path: '/expenses?pageSize=20' })],
    [5, 'GET /users', () => ({ method: 'GET', path: '/users?pageSize=20' })],
    [10, 'GET /audit-logs', () => ({ method: 'GET', path: '/audit-logs?limit=50' })],
    [
      5,
      'GET /customers (admin)',
      () => ({ method: 'GET', path: '/customers?pageSize=20&search=Bench%20mijoz%207' }),
    ],
  ];
}

function chooseOp(ops: Op[]) {
  const total = ops.reduce((sum, [weight]) => sum + weight, 0);
  let r = Math.random() * total;
  for (const op of ops) {
    r -= op[0];
    if (r <= 0) return op;
  }
  return ops[ops.length - 1]!;
}

async function virtualUser(
  token: string,
  ops: Op[],
  phase: (typeof PHASES)[number],
  stopAt: number,
) {
  const ip = nextIp();
  while (Date.now() < stopAt) {
    const [, endpoint, build] = chooseOp(ops);
    const req = build();
    const started = performance.now();
    let status: number;
    try {
      const res = await fetch(`${API}${req.path}`, {
        method: req.method,
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${token}`,
          'X-Forwarded-For': ip,
          ...(req.body ? { 'Content-Type': 'application/json' } : {}),
          ...req.headers,
        },
        body: req.body ? JSON.stringify(req.body) : undefined,
      });
      await res.arrayBuffer();
      status = res.status;
    } catch {
      status = -1;
    }
    if (phase.measured)
      samples.push({ phase: phase.name, endpoint, ms: performance.now() - started, status });
    await sleep(phase.thinkMs * (0.5 + Math.random()));
  }
}

/** Nearest-rank percentil. */
function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)]!;
}

function summarize(name: string, list: Sample[], seconds: number): BenchMetric {
  const ms = list.map((s) => s.ms).sort((a, b) => a - b);
  return {
    name,
    count: list.length,
    rps: Math.round((list.length / seconds) * 10) / 10,
    p50: percentile(ms, 50),
    p95: percentile(ms, 95),
    p99: percentile(ms, 99),
    max: ms[ms.length - 1] ?? 0,
    errors: list.filter((s) => s.status < 200 || s.status >= 300).length,
  };
}

beforeAll(async () => {
  t = await createAuthApp();
  const admins = [];
  for (let i = 0; i < ADMINS; i++)
    admins.push(await createUser(t, { password: PASSWORD, role: 'ADMIN' }));
  let started = performance.now();
  historyWarehouse = (await seedSales1M(admins[0]!.id)).sampleWarehouse;
  console.log(`Seed: ${Math.round((performance.now() - started) / 1000)} s`);

  started = performance.now();
  execFileSync(
    'pnpm',
    ['exec', 'swc', 'src', '-d', DIST, '--strip-leading-paths', '--copy-files'],
    {
      cwd: backendDir,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  server = spawn('node', [`${DIST}/main.js`], {
    cwd: backendDir,
    stdio: ['ignore', 'ignore', 'inherit'],
    env: {
      PATH: process.env.PATH,
      NODE_ENV: 'production',
      DATABASE_URL: inject('databaseUrl'),
      REDIS_URL: inject('redisUrl'),
      ...SECRETS,
      API_HOST: '127.0.0.1',
      API_PORT: String(PORT),
      CORS_ORIGINS: 'http://localhost:5173',
      TRUST_PROXY: '1',
      LOG_LEVEL: 'info',
    },
  });
  for (let i = 0; ; i++) {
    try {
      if ((await fetch(`${API}/health`)).ok) break;
    } catch {
      /* hali ishga tushmagan */
    }
    if (i > 200) throw new Error('yuklama serveri ishga tushmadi');
    await sleep(150);
  }
  console.log(`Server (production build): ${Math.round((performance.now() - started) / 1000)} s`);

  for (const admin of admins) adminTokens.push(await loginAs(admin.login));
  const token = adminTokens[0]!;
  loadWarehouse = (
    await must<{ id: string }>('POST', '/warehouses', { token, body: { name: 'Yuklama ombori' } })
  ).id;
  const group = await must<{ id: string }>('POST', '/product-groups', {
    token,
    body: { name: 'Yuklama guruhi' },
  });
  for (let i = 1; i <= LOAD_PRODUCTS; i++) {
    const barcode = `4790000${String(i).padStart(6, '0')}`;
    const p = await must<{ id: string }>('POST', '/products', {
      token,
      body: {
        name: `Yuklama ${i} mahsulot`,
        groupId: group.id,
        barcode,
        unit: 'DONA',
        allowDecimal: false,
        costPrice: String(1000 * i),
        salePrice: String(1500 * i),
      },
    });
    loadProducts.push({ id: p.id, barcode });
  }
  for (const [i, p] of loadProducts.entries()) {
    await must('POST', `/products/${p.id}/stock`, {
      token,
      body: {
        date: new Date().toISOString().slice(0, 10),
        warehouseId: loadWarehouse,
        quantity: '100000',
        costPrice: String(1000 * (i + 1)),
      },
    });
  }
  const sellers = await t.prisma.user.findMany({
    where: { login: { startsWith: 'bench' } },
    orderBy: { login: 'asc' },
  });
  expect(sellers).toHaveLength(SELLERS);
  for (const seller of sellers) {
    await must('PUT', `/users/${seller.id}/warehouses`, {
      token,
      body: { warehouseIds: [loadWarehouse, historyWarehouse] },
    });
    sellerTokens.push(await loginAs(seller.login));
  }
}, 1_800_000);

afterAll(async () => {
  server?.kill('SIGTERM');
  if (metrics.length > 0) {
    const [pg] = await t.prisma.$queryRaw<
      { version: string; shared_buffers: string; max_connections: string }[]
    >`
      SELECT current_setting('server_version') AS version, current_setting('shared_buffers') AS shared_buffers,
             current_setting('max_connections') AS max_connections`;
    const file = writeBenchResult({
      kind: 'load',
      environment: machineEnvironment({
        postgres: `PostgreSQL ${pg!.version} (postgres:18-alpine, Testcontainers, shared_buffers = ${pg!.shared_buffers}, max_connections = ${pg!.max_connections})`,
        redis: 'Redis 8 (redis:8-alpine, Testcontainers)',
        server: 'production build (swc), NODE_ENV=production, bitta Node jarayoni, pino info',
      }),
      dataset: {
        ...BENCH_DATASET,
        loadWarehouseProducts: LOAD_PRODUCTS,
        virtualUsers: `${SELLERS} sotuvchi + ${ADMINS} admin`,
      },
      method: `Yopiq sikl, har bir VU o'z tokeni/IP'si; ${PHASES.map((p) => `${p.name} ${p.seconds} s (pauza ${p.thinkMs} ms ×0.5–1.5${p.measured ? '' : ', o‘lchanmaydi'})`).join(' → ')}; kechikish — mijozda (fetch boshidan javob tanasi oxirigacha), nearest-rank percentil`,
      budget: { p95: P95_BUDGET_MS, errors: 0 },
      metrics,
    });
    console.log(`Natija: ${file}`);
  }
  await t?.close();
  await closePool();
});

describe(`API yuklama ostida (REQ-167: har bir endpoint p95 < ${P95_BUDGET_MS} ms)`, () => {
  it('bosqichlar: qizdirish → normal → peak', async () => {
    for (const phase of PHASES) {
      const stopAt = Date.now() + phase.seconds * 1000;
      await Promise.all([
        ...sellerTokens.map((token) => virtualUser(token, sellerOps(), phase, stopAt)),
        ...adminTokens.map((token) => virtualUser(token, adminOps(), phase, stopAt)),
      ]);
    }
    for (const phase of PHASES.filter((p) => p.measured)) {
      const inPhase = samples.filter((s) => s.phase === phase.name);
      metrics.push(summarize(`${phase.name} · JAMI`, inPhase, phase.seconds));
      for (const endpoint of [...new Set(inPhase.map((s) => s.endpoint))].sort()) {
        metrics.push(
          summarize(
            `${phase.name} · ${endpoint}`,
            inPhase.filter((s) => s.endpoint === endpoint),
            phase.seconds,
          ),
        );
      }
    }
    console.table(
      metrics.map((m) => ({
        'Bosqich · endpoint': m.name,
        "So'rov": m.count,
        RPS: m.rps,
        p50: Math.round(m.p50 as number),
        p95: Math.round(m.p95 as number),
        p99: Math.round(m.p99 as number),
        max: Math.round(m.max as number),
        Xato: m.errors,
      })),
    );
    const statuses = [
      ...new Set(
        samples
          .filter((s) => s.status < 200 || s.status >= 300)
          .map((s) => `${s.endpoint} → ${s.status}`),
      ),
    ];
    expect.soft(statuses, 'non-2xx javoblar').toEqual([]);
    for (const m of metrics) {
      expect.soft(m.p95 as number, `${m.name}: p95`).toBeLessThan(P95_BUDGET_MS);
    }
  }, 600_000);

  it('yuklamadan keyin yaxlitlik: yuklama omborida Σ harakatlar = qoldiq, manfiy qoldiq yo‘q', async () => {
    const rows = await t.prisma.$queryRaw<{ product_id: string; stock: string; ledger: string }[]>`
      SELECT ws.product_id, ws.quantity::text AS stock, coalesce(sum(m.quantity), 0)::text AS ledger
        FROM warehouse_stock ws
        LEFT JOIN inventory_movements m ON m.warehouse_id = ws.warehouse_id AND m.product_id = ws.product_id
       WHERE ws.warehouse_id = ${loadWarehouse}::uuid
       GROUP BY ws.product_id, ws.quantity`;
    expect(rows).toHaveLength(LOAD_PRODUCTS);
    for (const row of rows) {
      expect(Number(row.stock)).toBe(Number(row.ledger));
      expect(Number(row.stock)).toBeGreaterThanOrEqual(0);
    }
    const sold = samples.filter((s) => s.endpoint === 'POST /sales' && s.status === 201).length;
    const [count] = await t.prisma.$queryRaw<{ n: number }[]>`
      SELECT count(*)::int AS n FROM sales WHERE warehouse_id = ${loadWarehouse}::uuid`;
    // O'lchanmagan qizdirish bosqichidagi sotuvlar ham bor — kamida o'lchanganlar soni.
    expect(count!.n).toBeGreaterThanOrEqual(sold);
  });
});
