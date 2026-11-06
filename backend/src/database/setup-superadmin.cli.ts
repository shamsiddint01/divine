/**
 * Superadmin hisobi va birinchi sayt (`scripts/render/setup-superadmin.sh`). Parol `NEW_PASSWORD` env orqali
 * keladi va hech qayerga chiqarilmaydi. Qayta ishga tushirilsa — parol yangilanadi, sayt qayta qo'shilmaydi.
 */
// `.env` yuklovchi BIRINCHI import bo'lishi shart (qarang: config/load-env-file.ts).
import '../config/load-env-file.js';
import { PrismaPg } from '@prisma/adapter-pg';
import { parseBootstrapConfig } from '../config/env.schema.js';
import { PrismaClient } from '../generated/prisma/client.js';
import { PasswordHasher } from '../modules/auth/password/password-hasher.js';
import { controlApiToken } from '../modules/site/control-token.guard.js';
import { pgPoolConfig } from './pg-connection.js';

const login = (process.argv[2] ?? '').toLowerCase();
const password = process.env.NEW_PASSWORD ?? '';
const { SITE_URL, API_URL, OWNER_NAME, JWT_ACCESS_SECRET } = process.env;
if (!login || password.length < 10) {
  process.stderr.write('Login va kamida 10 belgili parol kerak\n');
  process.exit(1);
}
if (!SITE_URL || !API_URL || !OWNER_NAME || !JWT_ACCESS_SECRET) {
  process.stderr.write('SITE_URL, API_URL, OWNER_NAME va JWT_ACCESS_SECRET kerak\n');
  process.exit(1);
}

const config = parseBootstrapConfig();
const hasher = new PasswordHasher(config.PASSWORD_PEPPER, config.PASSWORD_PEPPER_V2);
const passwordHash = await hasher.hash(password);
const prisma = new PrismaClient({ adapter: new PrismaPg(pgPoolConfig(config.DATABASE_URL)) });

try {
  await prisma.controlAdmin.upsert({
    where: { login },
    create: { login, passwordHash },
    update: { passwordHash },
  });
  if ((await prisma.controlSite.count()) === 0) {
    const paidUntil = new Date(Date.now() + 30 * 86_400_000);
    paidUntil.setUTCHours(0, 0, 0, 0);
    await prisma.controlSite.create({
      data: {
        name: 'Divine',
        siteUrl: SITE_URL,
        apiUrl: API_URL,
        apiToken: controlApiToken({ JWT_ACCESS_SECRET, CONTROL_API_TOKEN: undefined }),
        ownerName: OWNER_NAME,
        agreedPrice: 0,
        paidUntil,
      },
    });
  }
  process.stdout.write('Superadmin tayyor.\n');
} finally {
  await prisma.$disconnect();
}
