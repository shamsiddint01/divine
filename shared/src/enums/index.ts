// Domain enumlari. TS `enum` o'rniga `as const` obyektlar: Zod (`z.enum`) va
// Prisma enumlari bilan bir xil string qiymatlar, isolatedModules bilan mos.
// Qiymatlar docs/DATABASE.md dagi DB enumlari bilan aynan bir xil bo'lishi shart.

const values = <T extends Record<string, string>>(obj: T) =>
  Object.values(obj) as [T[keyof T], ...T[keyof T][]];

export const RoleCode = { ADMIN: 'ADMIN', USER: 'USER' } as const;
export type RoleCode = (typeof RoleCode)[keyof typeof RoleCode];
export const ROLE_CODES = values(RoleCode);

export const UserStatus = { ACTIVE: 'ACTIVE', BLOCKED: 'BLOCKED' } as const;
export type UserStatus = (typeof UserStatus)[keyof typeof UserStatus];
export const USER_STATUSES = values(UserStatus);

export const ProductStatus = { ACTIVE: 'ACTIVE', INACTIVE: 'INACTIVE' } as const;
export type ProductStatus = (typeof ProductStatus)[keyof typeof ProductStatus];
export const PRODUCT_STATUSES = values(ProductStatus);

export const ProductUnit = { DONA: 'DONA', KG: 'KG', LITR: 'LITR', METR: 'METR' } as const;
export type ProductUnit = (typeof ProductUnit)[keyof typeof ProductUnit];
export const PRODUCT_UNITS = values(ProductUnit);

export const WarehouseStatus = { ACTIVE: 'ACTIVE', INACTIVE: 'INACTIVE' } as const;
export type WarehouseStatus = (typeof WarehouseStatus)[keyof typeof WarehouseStatus];
export const WAREHOUSE_STATUSES = values(WarehouseStatus);

/** Sotuv narxi turi (D-25): dona yoki optom. */
export const SalePriceType = { RETAIL: 'RETAIL', WHOLESALE: 'WHOLESALE' } as const;
export type SalePriceType = (typeof SalePriceType)[keyof typeof SalePriceType];
export const SALE_PRICE_TYPES = values(SalePriceType);

export const IncomingStatus = {
  DRAFT: 'DRAFT',
  CONFIRMED: 'CONFIRMED',
  CANCELLED: 'CANCELLED',
} as const;
export type IncomingStatus = (typeof IncomingStatus)[keyof typeof IncomingStatus];
export const INCOMING_STATUSES = values(IncomingStatus);

export const SaleStatus = { COMPLETED: 'COMPLETED' } as const;
export type SaleStatus = (typeof SaleStatus)[keyof typeof SaleStatus];
export const SALE_STATUSES = values(SaleStatus);

/**
 * Inventar harakati turi. Hozir faqat INCOMING va SALE ishlatiladi.
 * ADJUSTMENT / RETURN / TRANSFER — kelajak uchun zaxira (D-03 / A-12), API orqali yaratilmaydi.
 */
export const MovementType = {
  INCOMING: 'INCOMING',
  SALE: 'SALE',
  ADJUSTMENT: 'ADJUSTMENT',
  RETURN: 'RETURN',
  TRANSFER: 'TRANSFER',
} as const;
export type MovementType = (typeof MovementType)[keyof typeof MovementType];
export const MOVEMENT_TYPES = values(MovementType);

export const MovementReferenceType = { INCOMING: 'INCOMING', SALE: 'SALE' } as const;
export type MovementReferenceType =
  (typeof MovementReferenceType)[keyof typeof MovementReferenceType];
export const MOVEMENT_REFERENCE_TYPES = values(MovementReferenceType);

/** Audit qilinadigan amallar (REQ-120). */
export const AuditAction = {
  AUTH_LOGIN_SUCCEEDED: 'AUTH_LOGIN_SUCCEEDED',
  AUTH_LOGIN_FAILED: 'AUTH_LOGIN_FAILED',
  AUTH_ACCOUNT_LOCKED: 'AUTH_ACCOUNT_LOCKED',
  AUTH_LOGOUT: 'AUTH_LOGOUT',
  AUTH_REFRESH_REUSE_DETECTED: 'AUTH_REFRESH_REUSE_DETECTED',
  USER_CREATED: 'USER_CREATED',
  USER_UPDATED: 'USER_UPDATED',
  USER_STATUS_CHANGED: 'USER_STATUS_CHANGED',
  USER_PASSWORD_RESET: 'USER_PASSWORD_RESET',
  USER_WAREHOUSES_CHANGED: 'USER_WAREHOUSES_CHANGED',
  PRODUCT_GROUP_CREATED: 'PRODUCT_GROUP_CREATED',
  PRODUCT_GROUP_UPDATED: 'PRODUCT_GROUP_UPDATED',
  PRODUCT_GROUP_DELETED: 'PRODUCT_GROUP_DELETED',
  PRODUCT_CREATED: 'PRODUCT_CREATED',
  PRODUCT_UPDATED: 'PRODUCT_UPDATED',
  PRODUCT_STATUS_CHANGED: 'PRODUCT_STATUS_CHANGED',
  WAREHOUSE_CREATED: 'WAREHOUSE_CREATED',
  WAREHOUSE_UPDATED: 'WAREHOUSE_UPDATED',
  WAREHOUSE_STATUS_CHANGED: 'WAREHOUSE_STATUS_CHANGED',
  INCOMING_CREATED: 'INCOMING_CREATED',
  INCOMING_UPDATED: 'INCOMING_UPDATED',
  INCOMING_CONFIRMED: 'INCOMING_CONFIRMED',
  INCOMING_CANCELLED: 'INCOMING_CANCELLED',
  SALE_CREATED: 'SALE_CREATED',
  CUSTOMER_CREATED: 'CUSTOMER_CREATED',
  CUSTOMER_UPDATED: 'CUSTOMER_UPDATED',
  EXPENSE_CATEGORY_CREATED: 'EXPENSE_CATEGORY_CREATED',
  EXPENSE_CATEGORY_UPDATED: 'EXPENSE_CATEGORY_UPDATED',
  EXPENSE_CATEGORY_DELETED: 'EXPENSE_CATEGORY_DELETED',
  EXPENSE_CREATED: 'EXPENSE_CREATED',
  EXPENSE_UPDATED: 'EXPENSE_UPDATED',
  EXPENSE_DELETED: 'EXPENSE_DELETED',
  CREDIT_CREATED: 'CREDIT_CREATED',
  CREDIT_PAYMENT_ADDED: 'CREDIT_PAYMENT_ADDED',
  SETTINGS_UPDATED: 'SETTINGS_UPDATED',
  INVENTORY_RECONCILIATION_RUN: 'INVENTORY_RECONCILIATION_RUN',
} as const;
export type AuditAction = (typeof AuditAction)[keyof typeof AuditAction];
export const AUDIT_ACTIONS = values(AuditAction);

export const AuditEntityType = {
  USER: 'USER',
  PRODUCT_GROUP: 'PRODUCT_GROUP',
  PRODUCT: 'PRODUCT',
  WAREHOUSE: 'WAREHOUSE',
  INCOMING: 'INCOMING',
  SALE: 'SALE',
  CUSTOMER: 'CUSTOMER',
  EXPENSE_CATEGORY: 'EXPENSE_CATEGORY',
  EXPENSE: 'EXPENSE',
  CREDIT: 'CREDIT',
  SETTINGS: 'SETTINGS',
  INVENTORY: 'INVENTORY',
  SESSION: 'SESSION',
} as const;
export type AuditEntityType = (typeof AuditEntityType)[keyof typeof AuditEntityType];
export const AUDIT_ENTITY_TYPES = values(AuditEntityType);
