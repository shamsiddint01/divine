import { t } from '@/i18n/uz';
import {
  formatDate,
  formatDateTime,
  formatInteger,
  formatMoney,
  formatQuantity,
} from '@/shared/lib/format';

/** ID → nom (ombor, user, guruh, kategoriya) — audit sahifasidagi mavjud ro'yxatlardan. */
export type AuditLookups = Partial<
  Record<'warehouse' | 'user' | 'group' | 'category', Map<string, string>>
>;

const MONEY_KEYS = new Set(['costPrice', 'salePrice', 'wholesalePrice', 'totalAmount', 'amount']);
const QUANTITY_KEYS = new Set(['totalQuantity', 'lowStockDefaultThreshold', 'minStock']);
const ID_KEYS: Record<string, keyof AuditLookups> = {
  warehouseId: 'warehouse',
  warehouseIds: 'warehouse',
  added: 'warehouse',
  removed: 'warehouse',
  userId: 'user',
  groupId: 'group',
  categoryId: 'category',
};

const ISO_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export const keyLabel = (key: string): string =>
  (t.audit.keys as Record<string, string>)[key] ?? key;

/** Bitta qiymat — o'zbekcha matn. `key` — formatni aniqlash uchun (pul, miqdor, ID). */
export function formatValue(key: string, value: unknown, lookups: AuditLookups = {}): string {
  if (value === null || value === undefined || value === '') return t.common.notSet;
  if (typeof value === 'boolean') return value ? t.audit.yes : t.audit.no;
  if (typeof value === 'number') return formatInteger(value);
  if (Array.isArray(value)) {
    return value.length === 0
      ? t.common.notSet
      : value.map((item) => formatValue(key, item, lookups)).join(', ');
  }
  if (typeof value === 'object') return JSON.stringify(value);
  const text = String(value);
  const lookup = ID_KEYS[key];
  if (lookup) return lookups[lookup]?.get(text) ?? text;
  if (MONEY_KEYS.has(key)) return formatMoney(text);
  if (QUANTITY_KEYS.has(key)) return formatQuantity(text);
  if (key === 'role') return (t.roles as Record<string, string>)[text] ?? text;
  const code =
    (t.status as Record<string, string>)[text] ?? (t.audit.values as Record<string, string>)[text];
  if (code) return code;
  if (key === 'fields') return keyLabel(text);
  if (ISO_DATETIME.test(text)) return formatDateTime(text);
  if (ISO_DATE.test(text)) return formatDate(text);
  return text;
}

export interface MetadataLine {
  key: string;
  label: string;
  /** Oddiy qiymat yoki `oldin → keyin`. */
  value?: string;
  change?: { from: string; to: string };
  children?: MetadataLine[];
}

const isChange = (value: unknown): value is { from: unknown; to: unknown } =>
  typeof value === 'object' &&
  value !== null &&
  !Array.isArray(value) &&
  Object.keys(value).length === 2 &&
  'from' in value &&
  'to' in value;

/**
 * Metadata → ko'rsatiladigan qatorlar (D: umumiy kalit/qiymat, Phase 13). `{ from, to }` —
 * o'zgarish; ichma-ich obyekt (masalan, `changes`) — bolalar qatorlari, kalit konteksti saqlanadi.
 */
export function describeMetadata(
  metadata: Record<string, unknown>,
  lookups: AuditLookups = {},
): MetadataLine[] {
  return Object.entries(metadata).map(([key, value]): MetadataLine => {
    const label = keyLabel(key);
    if (isChange(value)) {
      return {
        key,
        label,
        change: {
          from: formatValue(key, value.from, lookups),
          to: formatValue(key, value.to, lookups),
        },
      };
    }
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      return { key, label, children: describeMetadata(value as Record<string, unknown>, lookups) };
    }
    return { key, label, value: formatValue(key, value, lookups) };
  });
}
