/**
 * `pnpm --filter @divine/backend db:seed` — ma'lumotnoma seed'i (idempotent, prod'da ham xavfsiz).
 * Dev: `tsx` orqali manba koddan; prod: `node dist/database/seed.cli.js`.
 * Migratsiyadan KEYIN ishga tushiriladi (`db:deploy` → `db:seed`).
 */
// `.env` yuklovchi BIRINCHI import bo'lishi shart (qarang: config/load-env-file.ts).
import '../config/load-env-file.js';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';
import { pgPoolConfig } from './pg-connection.js';
import { seedReferenceData } from './seed/seed-reference-data.js';

const url = process.env.DATABASE_URL;
if (!url) {
  process.stderr.write('DATABASE_URL berilmagan\n');
  process.exit(1);
}

const prisma = new PrismaClient({ adapter: new PrismaPg(pgPoolConfig(url)) });

try {
  const summary = await seedReferenceData(prisma);
  process.stdout.write(
    [
      'Seed yakunlandi:',
      `  rollar: ${summary.roles}`,
      `  permissionlar: ${summary.permissions}`,
      `  rol → permission bog'lanishlari: ${summary.rolePermissions}`,
      `  yangi sozlamalar: ${summary.insertedSettings.join(', ') || '— (barchasi mavjud)'}`,
      summary.removedPermissions.length > 0
        ? `  katalogdan olib tashlangan permissionlar: ${summary.removedPermissions.join(', ')}`
        : null,
    ]
      .filter(Boolean)
      .join('\n') + '\n',
  );
} catch (error) {
  process.stderr.write(
    `Seed xatosi: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
  );
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
