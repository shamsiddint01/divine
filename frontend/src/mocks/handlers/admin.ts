import {
  GENERATED_PASSWORD_LENGTH,
  createUserSchema,
  normalizeLogin,
  normalizeThreshold,
  replaceUserWarehousesSchema,
  settingsUpdateSchema,
  updateUserSchema,
  updateUserStatusSchema,
} from '@divine/shared';
import type { SettingsDto, UserCreatedResponse } from '@/shared/types/api';
import { db, resetDb } from '../db';
import { fail, includesText, notFound, paginate, route, sortBy, validate } from '../lib/http';
import { mockUuid } from '../lib/random';
import { diffChanges, hasChanges, recordAudit } from '../audit';
import { currentCan, toUserDto } from '../mappers';
import type { UserRow } from '../state';
import { nowIso } from '../lib/clock';

const now = nowIso;

/** Server tomondagi parol generatsiyasining aksi: CSPRNG, aynan 6 raqam (BR-04). */
export function generatePassword(): string {
  const buf = new Uint32Array(1);
  let value: number;
  do {
    crypto.getRandomValues(buf);
    value = buf[0] ?? 0;
  } while (value >= 4_294_000_000); // modulo bias'siz
  return String(value % 10 ** GENERATED_PASSWORD_LENGTH).padStart(GENERATED_PASSWORD_LENGTH, '0');
}

route('GET', '/health', () => ({
  status: 'ok',
  checks: { database: 'up', redis: 'up' },
  version: 'mock',
  timestamp: now(),
}));

// ─── Userlar ────────────────────────────────────────────────────────────────
// Backend bilan bir xil shartnoma (API §4): o'sha shared sxemalar, xato kodlari va BR-27 qoidalari.

const findUser = (id: string | undefined) => db().users.find((x) => x.id === id) ?? notFound();

const activeAdminsExcept = (id: string) =>
  db().users.filter((x) => x.role === 'ADMIN' && x.status === 'ACTIVE' && x.id !== id).length;

/** Mavjud bo'lishi shart; YANGI qo'shilayotgani ACTIVE bo'lishi shart (backend bilan bir xil). */
function assertAssignable(ids: readonly string[], current: readonly string[]) {
  const s = db();
  for (const id of ids) {
    const w = s.warehouses.find((x) => x.id === id);
    if (!w) fail(404, 'NOT_FOUND', [{ field: 'warehouseIds', message: 'Ma’lumot topilmadi' }]);
    if (w.status !== 'ACTIVE' && !current.includes(id)) {
      fail(422, 'WAREHOUSE_INACTIVE', [{ field: 'warehouseIds', message: 'Ombor faol emas' }]);
    }
  }
}

/** Backend `applyWarehouses` aksi: o'zgarsa — `USER_WAREHOUSES_CHANGED` (qo'shilgan/olib tashlangan). */
function setWarehouses(u: UserRow, next: string[]) {
  const added = next.filter((id) => !u.warehouseIds.includes(id));
  const removed = u.warehouseIds.filter((id) => !next.includes(id));
  u.warehouseIds = next;
  if (added.length === 0 && removed.length === 0) return;
  recordAudit({
    action: 'USER_WAREHOUSES_CHANGED',
    entityType: 'USER',
    entityId: u.id,
    metadata: { login: u.login, added, removed, warehouseIds: next },
  });
}

route('GET', '/users', ({ query }) => {
  const s = db();
  const list = s.users
    .filter((u) => includesText([u.login, u.fullName], query.search))
    .filter((u) => !query.role || u.role === query.role)
    .filter((u) => !query.status || u.status === query.status)
    .map((u) => toUserDto(s, u));
  const sorted = sortBy(
    list,
    query.sort,
    {
      login: (u) => u.login,
      createdAt: (u) => u.createdAt,
      lastLoginAt: (u) => u.lastLoginAt ?? '',
    },
    'createdAt:desc',
  );
  return paginate(sorted, query);
});

route('GET', '/users/warehouse-options', () =>
  db()
    .warehouses.filter((w) => w.status === 'ACTIVE')
    .map((w) => ({ id: w.id, name: w.name, address: w.address }))
    .sort((a, b) => a.name.localeCompare(b.name)),
);

route('GET', '/users/:id', ({ params }) => toUserDto(db(), findUser(params.id)));

route('POST', '/users', ({ body }): UserCreatedResponse => {
  const input = validate(createUserSchema, body);
  const s = db();
  if (s.users.some((u) => normalizeLogin(u.login) === normalizeLogin(input.login))) {
    fail(409, 'LOGIN_TAKEN', [{ field: 'login', message: 'Bu login band. Boshqa login kiriting' }]);
  }
  assertAssignable(input.warehouseIds, []);
  const at = now();
  const row = {
    id: mockUuid(),
    login: input.login,
    fullName: input.fullName ?? null,
    role: input.role,
    status: 'ACTIVE' as const,
    warehouseIds: input.warehouseIds,
    lastLoginAt: null,
    createdAt: at,
    updatedAt: at,
  };
  s.users.push(row);
  // Parol javobda bir marta qaytadi. Faqat demo uchun mock holatida eslab qolinadi — shu user bilan
  // login'ni sinash mumkin bo'lsin (haqiqiy backend'da faqat argon2id hash).
  const generatedPassword = generatePassword();
  s.passwords = { ...s.passwords, [row.id]: generatedPassword };
  recordAudit({
    action: 'USER_CREATED',
    entityType: 'USER',
    entityId: row.id,
    metadata: { login: input.login, role: input.role, warehouseIds: input.warehouseIds },
  });
  return { user: toUserDto(s, row), generatedPassword };
});

route('PATCH', '/users/:id', ({ params, body }) => {
  const input = validate(updateUserSchema, body);
  const s = db();
  const u = findUser(params.id);
  if (input.role !== undefined && input.role !== u.role) {
    if (u.id === s.currentUserId) fail(403, 'CANNOT_MODIFY_SELF');
    if (u.role === 'ADMIN' && u.status === 'ACTIVE' && activeAdminsExcept(u.id) === 0) {
      fail(409, 'LAST_ACTIVE_ADMIN');
    }
  }
  if (input.warehouseIds !== undefined) assertAssignable(input.warehouseIds, u.warehouseIds);
  const before = { ...u };
  if (input.fullName !== undefined) u.fullName = input.fullName ?? null;
  if (input.role !== undefined) u.role = input.role;
  const changes = diffChanges(before, u, ['role', 'fullName']);
  if (hasChanges(changes)) {
    recordAudit({
      action: 'USER_UPDATED',
      entityType: 'USER',
      entityId: u.id,
      metadata: { login: u.login, changes },
    });
  }
  if (input.warehouseIds !== undefined) setWarehouses(u, input.warehouseIds);
  u.updatedAt = now();
  return toUserDto(s, u);
});

route('PUT', '/users/:id/warehouses', ({ params, body }) => {
  const input = validate(replaceUserWarehousesSchema, body);
  const u = findUser(params.id);
  assertAssignable(input.warehouseIds, u.warehouseIds);
  setWarehouses(u, input.warehouseIds);
  u.updatedAt = now();
  return toUserDto(db(), u);
});

route('PATCH', '/users/:id/status', ({ params, body }) => {
  const input = validate(updateUserStatusSchema, body);
  const s = db();
  const u = findUser(params.id);
  if (u.id === s.currentUserId) fail(403, 'CANNOT_MODIFY_SELF');
  if (
    input.status === 'BLOCKED' &&
    u.role === 'ADMIN' &&
    u.status === 'ACTIVE' &&
    activeAdminsExcept(u.id) === 0
  ) {
    fail(409, 'LAST_ACTIVE_ADMIN');
  }
  if (u.status !== input.status) {
    recordAudit({
      action: 'USER_STATUS_CHANGED',
      entityType: 'USER',
      entityId: u.id,
      // Mock'da sessiyalar jadvali yo'q — bekor qilingan sessiyalar soni 0.
      metadata: { login: u.login, from: u.status, to: input.status, revokedSessions: 0 },
    });
  }
  u.status = input.status;
  u.updatedAt = now();
  return toUserDto(s, u);
});

route('POST', '/users/:id/reset-password', ({ params }) => {
  const s = db();
  const u = findUser(params.id);
  if (u.id === s.currentUserId) fail(403, 'CANNOT_MODIFY_SELF');
  u.updatedAt = now();
  const generatedPassword = generatePassword();
  s.passwords = { ...s.passwords, [u.id]: generatedPassword };
  recordAudit({
    action: 'USER_PASSWORD_RESET',
    entityType: 'USER',
    entityId: u.id,
    metadata: { login: u.login, revokedSessions: 0, lockCleared: false },
  });
  return { generatedPassword };
});

// ─── Sozlamalar ─────────────────────────────────────────────────────────────

// Backend bilan bir xil (API §16, D-21): 3 ta maydon, shared sxema, `settings.read` / `settings.manage`.

route('GET', '/settings', (): SettingsDto => {
  const s = db();
  if (!currentCan(s, 'settings.read')) fail(403, 'FORBIDDEN');
  return { ...s.settings };
});

route('PATCH', '/settings', ({ body }): SettingsDto => {
  const s = db();
  if (!currentCan(s, 'settings.manage')) fail(403, 'FORBIDDEN');
  const input = validate(settingsUpdateSchema, body);
  const before = { ...s.settings };
  if (input.companyName !== undefined) s.settings.companyName = input.companyName;
  if (input.currencyLabel !== undefined) s.settings.currencyLabel = input.currencyLabel;
  if (input.lowStockDefaultThreshold !== undefined) {
    s.settings.lowStockDefaultThreshold = normalizeThreshold(input.lowStockDefaultThreshold);
  }
  const changes = diffChanges(before, s.settings, [
    'companyName',
    'lowStockDefaultThreshold',
    'currencyLabel',
  ]);
  if (hasChanges(changes)) {
    recordAudit({ action: 'SETTINGS_UPDATED', entityType: 'SETTINGS', metadata: { changes } });
  }
  return { ...s.settings };
});

// Faqat mock rejim: demo ma'lumotlarni boshlang'ich holatga qaytarish.
route('POST', '/__demo/reset', () => {
  resetDb();
  return undefined;
});
