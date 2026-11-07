import { Injectable } from '@nestjs/common';
import type { BackupReportInput, BackupStatusDto } from '@divine/shared';
import { Clock } from '../../common/time/clock.js';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';

/** `settings` kaliti: migratsiyasiz, sayt o'z bekapining holatini o'zi saqlaydi. */
const KEY = 'backup_last';

/** Kechki bekap (GitHub Actions) natijasi: panel shuni ko'rsatadi. */
@Injectable()
export class BackupStatusService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
  ) {}

  async report(input: BackupReportInput): Promise<void> {
    const value: BackupStatusDto = {
      ok: input.ok,
      at: this.clock.now().toISOString(),
      sizeBytes: input.sizeBytes ?? null,
      runUrl: input.runUrl ?? null,
    };
    await this.prisma.setting.upsert({
      where: { key: KEY },
      create: { key: KEY, value: { ...value } },
      update: { value: { ...value } },
    });
  }

  async last(): Promise<BackupStatusDto | null> {
    const row = await this.prisma.setting.findUnique({ where: { key: KEY } });
    return row ? (row.value as unknown as BackupStatusDto) : null;
  }
}
