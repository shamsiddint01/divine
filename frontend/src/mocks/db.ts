import { MOCK_DB_CHANGED_EVENT } from '@/shared/lib/api-mode';
import { todayInTashkent } from '@/shared/lib/format';
import { mockNow, setMockNow } from './lib/clock';
import { createSeedState } from './seed';
import { type MockState, STATE_VERSION } from './state';

// Mock "DB": xotirada ushlanadi va har bir o'zgarishdan keyin brauzer xotirasiga yoziladi.
// Sahifa yangilansa ham kiritilgan sotuvlar, kirimlar va mahsulotlar saqlanib qoladi.
const STORAGE_KEY = 'divine.mock-db.v1';

let state: MockState | null = null;
let persistenceEnabled = typeof window !== 'undefined';

function load(): MockState | null {
  if (!persistenceEnabled) return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as MockState;
    if (parsed.version !== STATE_VERSION) return null;
    // Boshqa kunda yaratilgan va foydalanuvchi o'zgartirmagan demo — bugungi sanaga qayta yaratiladi,
    // shunda "Bugungi savdo" va grafiklar doim jonli ko'rinadi. O'zgartirilgan bo'lsa — saqlanadi.
    const seededDay = todayInTashkent(new Date(parsed.seededAt));
    if (!parsed.dirty && seededDay !== todayInTashkent(mockNow())) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function db(): MockState {
  if (!state) {
    state = load() ?? createSeedState(mockNow());
    persist();
    if (persistenceEnabled) window.addEventListener('storage', syncFromOtherTab);
  }
  return state;
}

/**
 * Bir brauzerning boshqa tabi (masalan, sotuvchi) ma'lumotni o'zgartirdi: shu tab eski nusxada qolmasin
 * va keyingi yozuvi u yerdagi o'zgarishni (sotuvni) ustidan yozib o'chirmasin.
 * Sessiya tabga xos qoladi — haqiqiy rejimdagi xotiradagi access token kabi.
 */
function syncFromOtherTab(event: StorageEvent): void {
  if (event.key !== STORAGE_KEY || !event.newValue || !state) return;
  try {
    const next = JSON.parse(event.newValue) as MockState;
    if (next.version !== STATE_VERSION) return;
    state = { ...next, currentUserId: state.currentUserId };
    window.dispatchEvent(new Event(MOCK_DB_CHANGED_EVENT));
  } catch {
    // Buzilgan yozuv — joriy nusxa saqlanib qoladi.
  }
}

export function persist(): void {
  if (!persistenceEnabled || !state) return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Xotira to'lgan yoki yopiq (private rejim) — ma'lumotlar faqat shu sessiyada qoladi.
  }
}

/** Mutatsiyadan keyin: demo endi foydalanuvchi ma'lumotlarini o'z ichiga oladi. */
export function markDirty(): void {
  if (state) state.dirty = true;
  persist();
}

/** Demo ma'lumotlarni boshlang'ich holatga qaytarish. */
export function resetDb(): MockState {
  state = createSeedState(mockNow());
  persist();
  return state;
}

/** Testlar uchun: localStorage'siz, aniq vaqtdagi toza holat (mock soati ham shu vaqtga qotiriladi). */
export function resetEphemeralDb(now: Date): MockState {
  persistenceEnabled = false;
  setMockNow(now);
  state = createSeedState(now);
  return state;
}
