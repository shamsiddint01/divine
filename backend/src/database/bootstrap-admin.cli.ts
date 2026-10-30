/**
 * Birinchi ADMIN'ni yaratish (A-21, D-10, SECURITY §5.2):
 *
 *   pnpm --filter @divine/backend db:bootstrap-admin -- --login admin [--full-name "Akmal Rahimov"]
 *   (prod)  node dist/database/bootstrap-admin.cli.js --login admin
 *
 * Login berilmasa — `SEED_ADMIN_LOGIN` env. Parol 6 xonali, server generatsiya qiladi va FAQAT shu
 * terminal chiqishida bir marta ko'rsatiladi (log, audit va DB'da ochiq holda yo'q).
 * Tizimda ADMIN allaqachon bo'lsa — hech narsa qilmaydi va 3-kod bilan chiqadi.
 * Migratsiya va `db:seed` dan KEYIN ishga tushiriladi.
 */
// `.env` yuklovchi BIRINCHI import bo'lishi shart (qarang: config/load-env-file.ts).
import '../config/load-env-file.js';
import { parseArgs } from 'node:util';
import { loginSchema } from '@divine/shared';
import { PrismaPg } from '@prisma/adapter-pg';
import { parseBootstrapConfig } from '../config/env.schema.js';
import { PrismaClient } from '../generated/prisma/client.js';
import { bootstrapAdmin } from '../modules/auth/bootstrap/bootstrap-admin.js';
import { PasswordHasher } from '../modules/auth/password/password-hasher.js';
import { pgPoolConfig } from './pg-connection.js';

const EXIT = {
  OK: 0,
  CONFIG: 1,
  INPUT: 2,
  ADMIN_EXISTS: 3,
  LOGIN_TAKEN: 4,
  NOT_SEEDED: 5,
} as const;

function fail(message: string, code: number): never {
  process.stderr.write(`${message}\n`);
  process.exit(code);
}

let config;
try {
  config = parseBootstrapConfig();
} catch (error) {
  // InvalidConfigError xabarida faqat kalit nomlari — qiymatlar (pepper) yo'q.
  fail(error instanceof Error ? error.message : 'Konfiguratsiya xato', EXIT.CONFIG);
}

const { values } = parseArgs({
  options: { login: { type: 'string' }, 'full-name': { type: 'string' } },
  strict: true,
});
const login = values.login ?? config.SEED_ADMIN_LOGIN;
if (!login) fail('Login berilmagan: --login <login> yoki SEED_ADMIN_LOGIN', EXIT.INPUT);
const parsedLogin = loginSchema.safeParse(login);
if (!parsedLogin.success)
  fail(`Login noto‘g‘ri: ${parsedLogin.error.issues[0]?.message}`, EXIT.INPUT);

const prisma = new PrismaClient({ adapter: new PrismaPg(pgPoolConfig(config.DATABASE_URL)) });
try {
  const result = await bootstrapAdmin(
    prisma,
    new PasswordHasher(config.PASSWORD_PEPPER, config.PASSWORD_PEPPER_V2),
    {
      login: parsedLogin.data,
      fullName: values['full-name'],
    },
  );
  switch (result.status) {
    case 'created':
      process.stdout.write(
        [
          '',
          'Birinchi administrator yaratildi.',
          `  Login: ${result.login}`,
          `  Parol: ${result.password}`,
          '',
          'Parol FAQAT HOZIR ko‘rsatildi va hech qayerda saqlanmadi — darhol xavfsiz joyga yozib oling.',
          'Unutilsa: admin boshqa admin orqali tiklanadi (Phase 5) yoki DB administratori aralashadi.',
          '',
        ].join('\n'),
      );
      break;
    case 'admin_exists':
      fail('Tizimda administrator allaqachon mavjud — yangi admin yaratilmadi.', EXIT.ADMIN_EXISTS);
      break;
    case 'login_taken':
      fail('Bu login band — boshqa login bilan qayta urinib ko‘ring.', EXIT.LOGIN_TAKEN);
      break;
    case 'roles_missing':
      fail('Rollar topilmadi: avval `db:deploy` va `db:seed` ni bajaring.', EXIT.NOT_SEEDED);
  }
} catch (error) {
  // Xato xabarida parol yo'q (u faqat muvaffaqiyatli natijada mavjud); Prisma argumentlari chiqmasin.
  process.stderr.write(
    `Bootstrap xatosi: ${error instanceof Error ? error.name : 'noma’lum'} — DB ulanishini tekshiring.\n`,
  );
  process.exitCode = EXIT.CONFIG;
} finally {
  await prisma.$disconnect();
}
