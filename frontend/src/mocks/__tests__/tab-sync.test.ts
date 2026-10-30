import { afterEach, describe, expect, it, vi } from 'vitest';
import { MOCK_DB_CHANGED_EVENT } from '@/shared/lib/api-mode';
import { db } from '../db';
import type { MockState } from '../state';

const STORAGE_KEY = 'divine.mock-db.v1';

/** Boshqa tab localStorage'ga yozgandagi brauzer hodisasi. */
function otherTabWrites(next: MockState | string, key = STORAGE_KEY) {
  const newValue = typeof next === 'string' ? next : JSON.stringify(next);
  window.dispatchEvent(new StorageEvent('storage', { key, newValue }));
}

afterEach(() => vi.restoreAllMocks());

describe('mock DB: tablar orasida sinxronlash', () => {
  it('boshqa tabdagi sotuv shu tabda ko‘rinadi; tab sessiyasi (user) almashmaydi', () => {
    const mine = db();
    const myUser = mine.currentUserId;
    const changed = vi.fn();
    window.addEventListener(MOCK_DB_CHANGED_EVENT, changed);

    const other = structuredClone(mine);
    const [key] = Object.keys(other.stock);
    other.stock[key as string] = '0.000';
    other.counters.sale += 1;
    other.currentUserId = 'boshqa-tab-useri';
    otherTabWrites(other);

    expect(db().stock[key as string]).toBe('0.000');
    expect(db().counters.sale).toBe(other.counters.sale);
    expect(db().currentUserId).toBe(myUser);
    expect(changed).toHaveBeenCalledTimes(1);
    window.removeEventListener(MOCK_DB_CHANGED_EVENT, changed);
  });

  it('begona kalit, boshqa versiya yoki buzilgan JSON e’tiborsiz qoldiriladi', () => {
    const before = JSON.stringify(db());
    otherTabWrites({ ...db(), counters: { ...db().counters, sale: -1 } }, 'boshqa-kalit');
    otherTabWrites({ ...db(), version: -1 } as MockState);
    otherTabWrites('{buzilgan');
    expect(JSON.stringify(db())).toBe(before);
  });
});
