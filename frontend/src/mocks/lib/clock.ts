import { todayInTashkent } from '@/shared/lib/format';

// Mock "server" soati. Brauzerda — real vaqt; testlarda — qotirilgan vaqt (natijalar barqaror bo'lishi uchun).
let fixed: Date | null = null;

export function setMockNow(date: Date | null): void {
  fixed = date;
}

export const mockNow = (): Date => fixed ?? new Date();
export const nowIso = (): string => mockNow().toISOString();
export const mockToday = (): string => todayInTashkent(mockNow());
