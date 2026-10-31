import { hasAny, usePermissions } from '@/features/session/hooks/use-permissions';
import { NAV_ITEMS, NAV_SECTIONS, type NavItem, type NavSection } from '../navigation';

export type VisibleNavSection = NavSection & { items: NavItem[] };

/**
 * RBAC §3.1: menyuda faqat ruxsat etilgan bo'limlar (UX; haqiqiy himoya — backend). Bo'sh guruh
 * yashiriladi. Yon panel va telefon pastki paneli shu bitta ro'yxatdan foydalanadi.
 */
export function useNavSections(): VisibleNavSection[] {
  const permissions = usePermissions();
  return NAV_SECTIONS.map((section) => ({
    ...section,
    items: section.keys
      .map((key) => NAV_ITEMS.find((i) => i.key === key))
      .filter((item): item is NavItem => Boolean(item) && hasAny(permissions, item!.anyOf)),
  })).filter((section) => section.items.length > 0);
}
