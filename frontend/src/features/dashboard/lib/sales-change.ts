import { percent, subMoney } from '@/shared/lib/decimal';
import type { DashboardSummaryDto } from '@/shared/types/api';

/** Bugungi savdoning kechaga nisbatan o'zgarishi, masalan "+12,4%". Kecha savdo bo'lmasa — null. */
export function salesChange(summary: DashboardSummaryDto): { text: string; up: boolean } | null {
  const diff = subMoney(summary.today.salesAmount, summary.yesterday.salesAmount);
  const p = percent(diff, summary.yesterday.salesAmount);
  if (p === null) return null;
  const up = !p.startsWith('-');
  return { text: `${up ? '+' : ''}${p.replace('.', ',')}%`, up };
}
