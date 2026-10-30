import { describe, expect, it } from 'vitest';
import type { DashboardSummaryDto } from '@/shared/types/api';
import { salesChange } from './sales-change';

const summary = (today: string, yesterday: string) =>
  ({ today: { salesAmount: today }, yesterday: { salesAmount: yesterday } }) as DashboardSummaryDto;

describe('bugun vs kecha savdo o‘zgarishi', () => {
  it('o‘sish, kamayish, o‘zgarishsiz; kecha savdo bo‘lmasa — ko‘rsatilmaydi', () => {
    expect(salesChange(summary('1124000', '1000000'))).toEqual({ text: '+12,4%', up: true });
    expect(salesChange(summary('500000', '1000000'))).toEqual({ text: '-50,0%', up: false });
    expect(salesChange(summary('100', '100'))).toEqual({ text: '+0,0%', up: true });
    expect(salesChange(summary('100', '0'))).toBeNull();
  });
});
