import type { Permission } from '@divine/shared';
import { useMemo } from 'react';
import { useCurrentUser } from '../api/session';

/**
 * Joriy userning permissionlari (`/auth/me`). Faqat UX uchun: tugma/menyu/sahifani yashirish.
 * Haqiqiy himoya — backend'da (RBAC §5). Rol nomi bo'yicha shart yozilmaydi, faqat permission kodlari.
 */
export function usePermissions(): ReadonlySet<Permission> {
  const { data } = useCurrentUser();
  return useMemo(() => new Set((data?.permissions ?? []) as Permission[]), [data]);
}

/** Kamida bittasi bormi (OR). Bo'sh ro'yxat — cheklov yo'q. */
export function hasAny(
  permissions: ReadonlySet<Permission>,
  anyOf: readonly Permission[],
): boolean {
  return anyOf.length === 0 || anyOf.some((permission) => permissions.has(permission));
}

export function useHasAnyPermission(anyOf: readonly Permission[]): boolean {
  return hasAny(usePermissions(), anyOf);
}
