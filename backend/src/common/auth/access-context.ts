import { ErrorCode, Permission, type RoleCode } from '@divine/shared';
import { AppError } from '../errors/app-error.js';

/**
 * Autentifikatsiyalangan so'rov konteksti (RBAC §4.1). JwtAuthGuard har so'rovda DB'dan yig'adi
 * va service metodlariga parametr sifatida uzatiladi (service HTTP obyektlarini bilmaydi).
 */
export interface AccessContext {
  userId: string;
  login: string;
  role: RoleCode;
  permissions: ReadonlySet<Permission>;
  /** `user_warehouses` — USER ownership manbai (D-04). */
  warehouseIds: ReadonlySet<string>;
  /** Access token qachon berilgan (soniya). */
  issuedAt: number;
}

export const hasPermission = (ctx: AccessContext, permission: Permission): boolean =>
  ctx.permissions.has(permission);

export const hasAnyPermission = (ctx: AccessContext, permissions: readonly Permission[]): boolean =>
  permissions.some((permission) => ctx.permissions.has(permission));

/**
 * Ombor ownership (RBAC §6, OWN-01…03, OWN-09). `warehouses.read_all` bo'lsa (ADMIN) — barcha omborlar;
 * aks holda faqat biriktirilganlari. Rol nomi bo'yicha emas, permission bo'yicha (RBAC §1).
 */
export function canAccessWarehouse(ctx: AccessContext, warehouseId: string): boolean {
  return hasPermission(ctx, Permission.WAREHOUSES_READ_ALL) || ctx.warehouseIds.has(warehouseId);
}

/** OWN-02: biriktirilmagan omborga amal → `403 WAREHOUSE_ACCESS_DENIED`. */
export function assertWarehouseAccess(ctx: AccessContext, warehouseId: string): void {
  if (!canAccessWarehouse(ctx, warehouseId)) throw new AppError(ErrorCode.WAREHOUSE_ACCESS_DENIED);
}

/**
 * Repository filtri uchun: `undefined` — cheklov yo'q (barcha omborlar), aks holda ruxsat etilgan ID'lar.
 * `WHERE warehouse_id = ANY($ids)` (OWN-01, OWN-03).
 */
export function warehouseScope(ctx: AccessContext): string[] | undefined {
  return hasPermission(ctx, Permission.WAREHOUSES_READ_ALL) ? undefined : [...ctx.warehouseIds];
}

/**
 * "O'ziniki yoki hammasi" turidagi ruxsat (OWN-04, OWN-05): `allPermission` bo'lsa — cheklov yo'q
 * (`undefined`), aks holda faqat `ctx.userId`. Query'dagi `userId` bunday user uchun e'tiborga olinmaydi.
 */
export function ownerScope(ctx: AccessContext, allPermission: Permission): string | undefined {
  return hasPermission(ctx, allPermission) ? undefined : ctx.userId;
}
