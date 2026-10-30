import { type ChildProcess, execFileSync, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';

/*
 * Playwright E2E muhiti (Phase 15, TESTING.md §4) — har ishga tushishda toza va izolyatsiyalangan:
 *   1. vaqtinchalik PostgreSQL 18 + Redis 8 konteynerlari (`docker run --rm`, tasodifiy portlar);
 *   2. `prisma migrate deploy` + `db:seed` + admin bootstrap (parol faqat xotirada, faylga yozilmaydi);
 *   3. backend — production build (swc), `NODE_ENV=production`, alohida jarayon;
 *   4. frontend — `VITE_API_MODE=http` build + `vite preview` (API proxy backend'ga).
 * Dev serverlar (3100, 5180…) va dev DB'ga tegilmaydi. Teardown hammasini o'chiradi.
 */
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const BACKEND = `${ROOT}backend`;
const FRONTEND = `${ROOT}frontend`;
export const E2E_API_PORT = 3190;
export const E2E_WEB_PORT = 5190;
const BACKEND_DIST = `${BACKEND}/node_modules/.cache/e2e-playwright-dist`;
const WEB_DIST = `${FRONTEND}/node_modules/.cache/e2e-playwright-web`;
const TAG = `divine-pw-${process.pid}`;

const docker = (...args: string[]) =>
  execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const hostPort = (container: string, port: number) =>
  docker('port', container, String(port)).split('\n')[0]!.split(':').pop()!;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitUntil(what: string, check: () => Promise<boolean> | boolean, ms = 60_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try {
      if (await check()) return;
    } catch {
      /* hali tayyor emas */
    }
    await sleep(300);
  }
  throw new Error(`E2E: ${what} ${ms / 1000} s ichida tayyor bo'lmadi`);
}

export default async function globalSetup(): Promise<() => Promise<void>> {
  const processes: ChildProcess[] = [];
  const containers = [`${TAG}-pg`, `${TAG}-redis`];
  const teardown = async () => {
    for (const child of processes) child.kill('SIGTERM');
    for (const name of containers) {
      try {
        docker('stop', name);
      } catch {
        /* allaqachon to'xtagan */
      }
    }
  };
  try {
    const pgPassword = randomBytes(12).toString('hex');
    docker(
      'run',
      '-d',
      '--rm',
      '--name',
      containers[0]!,
      '-e',
      'POSTGRES_DB=divine',
      '-e',
      'POSTGRES_USER=divine',
      '-e',
      `POSTGRES_PASSWORD=${pgPassword}`,
      '-p',
      '127.0.0.1::5432',
      'postgres:18-alpine',
    );
    docker(
      'run',
      '-d',
      '--rm',
      '--name',
      containers[1]!,
      '-p',
      '127.0.0.1::6379',
      'redis:8-alpine',
    );
    await waitUntil('PostgreSQL', () => {
      docker('exec', containers[0]!, 'pg_isready', '-U', 'divine', '-d', 'divine');
      return true;
    });
    await sleep(1500);

    const env: NodeJS.ProcessEnv = {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      NODE_ENV: 'production',
      DATABASE_URL: `postgresql://divine:${pgPassword}@127.0.0.1:${hostPort(containers[0]!, 5432)}/divine?schema=public`,
      MIGRATION_DATABASE_URL: '',
      REDIS_URL: `redis://127.0.0.1:${hostPort(containers[1]!, 6379)}`,
      // Har ishga tushishda yangi, tasodifiy secretlar (production tekshiruvlaridan o'tadi).
      JWT_ACCESS_SECRET: randomBytes(32).toString('hex'),
      PASSWORD_PEPPER: randomBytes(32).toString('hex'),
      API_HOST: '127.0.0.1',
      API_PORT: String(E2E_API_PORT),
      CORS_ORIGINS: `http://localhost:${E2E_WEB_PORT}`,
      LOG_LEVEL: 'warn',
    };
    const run = (cwd: string, args: string[], extra: NodeJS.ProcessEnv = {}) =>
      execFileSync('pnpm', args, {
        cwd,
        env: { ...env, ...extra },
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });

    run(BACKEND, ['exec', 'prisma', 'migrate', 'deploy'], { NODE_ENV: 'development' });
    run(BACKEND, ['db:seed'], { NODE_ENV: 'development' });
    const bootstrap = run(
      BACKEND,
      ['exec', 'tsx', 'src/database/bootstrap-admin.cli.ts', '--login', 'e2eadmin'],
      {
        NODE_ENV: 'development',
      },
    );
    const password = bootstrap.match(/\b\d{6}\b/)?.[0];
    if (!password) throw new Error('E2E: bootstrap admin paroli topilmadi');
    // Testlar (worker jarayonlari) shu env'ni meros oladi; diskka yozilmaydi.
    process.env.E2E_ADMIN_LOGIN = 'e2eadmin';
    process.env.E2E_ADMIN_PASSWORD = password;

    run(BACKEND, [
      'exec',
      'swc',
      'src',
      '-d',
      BACKEND_DIST,
      '--strip-leading-paths',
      '--copy-files',
    ]);
    const api = spawn('node', [`${BACKEND_DIST}/main.js`], {
      cwd: BACKEND,
      env,
      stdio: ['ignore', 'ignore', 'inherit'],
    });
    processes.push(api);
    await waitUntil(
      'backend',
      async () => (await fetch(`http://127.0.0.1:${E2E_API_PORT}/api/v1/health`)).ok,
    );

    run(FRONTEND, ['exec', 'vite', 'build', '--outDir', WEB_DIST, '--emptyOutDir'], {
      NODE_ENV: undefined,
      VITE_API_MODE: 'http',
      VITE_AUTH_MODE: 'http',
    });
    // `node vite.js` to'g'ridan-to'g'ri (pnpm orqali emas) — teardown'da jarayon yetim qolmasin.
    const web = spawn(
      'node',
      [
        'node_modules/vite/bin/vite.js',
        'preview',
        '--outDir',
        WEB_DIST,
        '--port',
        String(E2E_WEB_PORT),
        '--strictPort',
      ],
      {
        cwd: FRONTEND,
        env: {
          ...env,
          NODE_ENV: undefined,
          VITE_DEV_API_PROXY_TARGET: `http://127.0.0.1:${E2E_API_PORT}`,
        },
        stdio: 'ignore',
      },
    );
    processes.push(web);
    await waitUntil('frontend', async () => (await fetch(`http://localhost:${E2E_WEB_PORT}/`)).ok);
  } catch (error) {
    await teardown();
    throw error;
  }
  return teardown;
}
