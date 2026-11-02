import type { Permission } from '../permissions/index.js';
import type { ReportColumn, ReportGroupItem, ReportSummaryItem } from '../reports/index.js';
import type { Paginated } from '../validation/pagination.js';
import type {
  AuditAction,
  AuditEntityType,
  ProductStatus,
  ProductUnit,
  RoleCode,
  UserStatus,
  WarehouseStatus,
} from '../enums/index.js';

/** Pul summasi: NUMERIC(18,2) qiymatining string ko'rinishi, masalan `"1250000.00"`. */
export type MoneyString = string;

/** Miqdor: NUMERIC(14,3) qiymatining string ko'rinishi, masalan `"2.500"`. */
export type QuantityString = string;

/** ISO 8601 UTC vaqt belgisi, masalan `"2026-10-06T09:35:00.000Z"`. */
export type IsoDateTimeString = string;

/** Biznes sanasi `YYYY-MM-DD`. */
export type DateOnlyString = string;

/** `GET /auth/me` javobi — frontend RBAC (navigatsiya, route guard) shu ma'lumotga tayanadi. */
export interface CurrentUser {
  id: string;
  login: string;
  fullName: string | null;
  role: RoleCode;
  status: UserStatus;
  permissions: Permission[];
  warehouseIds: string[];
}

/** Users moduli (API §4). Parol, hash, sessiya va lockout hisoblagichlari hech qachon qaytmaydi. */
export interface UserDto {
  id: string;
  login: string;
  fullName: string | null;
  role: RoleCode;
  /** Admin boshqaradigan holat (BR-28). */
  status: UserStatus;
  /**
   * Login lockout (vaqtinchalik, SECURITY §4) — holatdan ALOHIDA: bloklash/blokdan chiqarish uni
   * o'zgartirmaydi, parol tiklash tozalaydi. `null` — cheklov yo'q.
   */
  lockedUntil: IsoDateTimeString | null;
  warehouses: { id: string; name: string }[];
  lastLoginAt: IsoDateTimeString | null;
  createdAt: IsoDateTimeString;
  updatedAt: IsoDateTimeString;
}

/** `POST /users` (201): parol faqat shu javobda bir marta. */
export interface UserCreatedResponse {
  user: UserDto;
  generatedPassword: string;
}

/** `POST /users/:id/reset-password` (200): yangi parol faqat shu javobda bir marta. */
export interface PasswordResetResponse {
  generatedPassword: string;
}

/** `GET /users/warehouse-options`: user formasidagi ombor tanlovi (faqat ACTIVE omborlar). */
export interface WarehouseOption {
  id: string;
  name: string;
  address: string | null;
}

/** Mahsulot guruhi (API §5). `productCount` — guruhdagi barcha mahsulotlar (arxivlanganlar ham). */
export interface ProductGroupDto {
  id: string;
  name: string;
  description: string | null;
  isActive: boolean;
  productCount: number;
  createdAt: IsoDateTimeString;
  updatedAt: IsoDateTimeString;
}

export interface ProductStockByWarehouse {
  warehouseId: string;
  warehouseName: string;
  quantity: QuantityString;
}

/**
 * Mahsulot (API §6). `costPrice` — FAQAT `products.read_cost` bo'lsa; aks holda kalit umuman yo'q
 * (OWN-06, AC-20). Miqdorlar userning ombor doirasi bo'yicha (USER — biriktirilgan omborlar, OWN-03).
 */
export interface ProductDto {
  id: string;
  name: string;
  groupId: string;
  groupName: string;
  barcode: string | null;
  salePrice: MoneyString;
  costPrice?: MoneyString;
  unit: ProductUnit;
  allowDecimal: boolean;
  minStock: QuantityString | null;
  status: ProductStatus;
  /** Joriy qoldiq (filtrdagi ombor yoki ruxsat etilgan barcha omborlar bo'yicha). */
  stock: QuantityString;
  /** Tasdiqlangan kirimlar va sotuvlar jami (shu ombor doirasida). */
  received: QuantityString;
  sold: QuantityString;
  isLowStock: boolean;
  warehouses: ProductStockByWarehouse[];
  createdAt: IsoDateTimeString;
  updatedAt: IsoDateTimeString;
}

export interface ProductSaleRow {
  saleId: string;
  saleNumber: string;
  soldAt: IsoDateTimeString;
  customerName: string;
  warehouseName: string;
  quantity: QuantityString;
  unitPrice: MoneyString;
  lineTotal: MoneyString;
}

/** `GET /products/:id/summary` — faqat `products.read_cost` (tushum, kelgan narxi va foyda). */
export interface ProductSummaryDto {
  product: ProductDto;
  totalRevenue: MoneyString;
  totalCost: MoneyString;
  grossProfit: MoneyString;
  recentSales: ProductSaleRow[];
}

/** Ombor (API §7) — yaratish, tahrirlash va holat javobi; USER ro'yxatida ham faqat shu maydonlar (OWN-01). */
export interface WarehouseDto {
  id: string;
  name: string;
  address: string | null;
  status: WarehouseStatus;
  createdAt: IsoDateTimeString;
  updatedAt: IsoDateTimeString;
}

/**
 * Ombor ko'rsatkichlari — FAQAT `warehouses.read_all` (ADMIN). `stockValue` (Σ qoldiq × kelgan narxi) —
 * qo'shimcha ravishda `products.read_cost` bo'lsa; aks holda kalit yo'q (OWN-06).
 */
export interface WarehouseStats {
  /** Qoldig'i > 0 bo'lgan mahsulotlar soni. */
  productCount: number;
  totalQuantity: QuantityString;
  stockValue?: MoneyString;
  /** Faol mahsulotlar: qoldiq ≤ minimal qoldiq (BUSINESS-RULES §4). */
  lowStockCount: number;
}

/** `GET /warehouses` qatori: ko'rsatkichlar faqat `warehouses.read_all` bo'lsa keladi. */
export type WarehouseListItemDto = WarehouseDto & Partial<WarehouseStats>;

/** `GET /warehouses/:id` — ko'rsatkichlar + so'nggi 30 kun (Toshkent kunlari) kirim va chiqim miqdori. */
export interface WarehouseDetailDto extends WarehouseDto, WarehouseStats {
  incoming30: QuantityString;
  outgoing30: QuantityString;
}

/** `GET /warehouses/:id/stock` qatori. `costPrice`, `stockValue` — faqat `products.read_cost`. */
export interface StockRowDto {
  productId: string;
  productName: string;
  groupName: string;
  barcode: string | null;
  unit: ProductUnit;
  quantity: QuantityString;
  /** Mahsulotning `min_stock`i, bo'lmasa global chegara. */
  minStock: QuantityString;
  costPrice?: MoneyString;
  salePrice: MoneyString;
  stockValue?: MoneyString;
  isLowStock: boolean;
  /** Qoldiq oxirgi marta o'zgargan vaqt. */
  updatedAt: IsoDateTimeString;
}

export interface UserRefDto {
  id: string;
  login: string;
  fullName: string | null;
}

/** Ledger yozuvi (API §2, §8). `unitCost` — faqat `products.read_cost`. */
export interface MovementDto {
  /** BIGINT — string sifatida. */
  id: string;
  warehouseId: string;
  warehouseName: string;
  productId: string;
  productName: string;
  unit: ProductUnit;
  movementType: 'INCOMING' | 'SALE';
  /** Ishorali: kirim `+`, chiqim `−`. */
  quantity: QuantityString;
  balanceAfter: QuantityString;
  unitCost?: MoneyString | null;
  referenceType: 'INCOMING' | 'SALE';
  referenceId: string;
  /** `K-000123` / `S-000456`. */
  referenceNumber: string;
  createdBy: UserRefDto;
  createdAt: IsoDateTimeString;
}

/** `GET /inventory/reconciliation` (REQ-132, AC-23): bo'sh `mismatches` — qoldiq va ledger mos. */
export interface ReconciliationMismatch {
  warehouseId: string;
  warehouseName: string;
  productId: string;
  productName: string;
  stockQuantity: QuantityString;
  ledgerQuantity: QuantityString;
  lastBalanceAfter: QuantityString;
}

export interface ReconciliationResult {
  checkedAt: IsoDateTimeString;
  /** Tekshirilgan (ombor, mahsulot) juftliklari: `warehouse_stock` ∪ ledger. */
  pairsChecked: number;
  mismatchCount: number;
  mismatches: ReconciliationMismatch[];
  /** Hujjat ↔ ledger (`reconcile_document_movements`) va hujjat totallari (`reconcile_document_totals`). */
  documentIssueCount: number;
  /** Mijoz yig'ma ustunlari (`reconcile_customer_aggregates`). */
  customerIssueCount: number;
}

/**
 * Mijoz (API §10). Ism va telefon unique emas (A-23). `notes` va yig'malar (`purchaseCount`,
 * `totalSpent`, `lastPurchaseAt`) — FAQAT `customers.read_history`; USER (OWN-07) faqat `id, name, phone`.
 */
export interface CustomerDto {
  id: string;
  name: string;
  /** `+998XXXXXXXXX` yoki null. */
  phone: string | null;
  notes?: string | null;
  purchaseCount?: number;
  totalSpent?: MoneyString;
  lastPurchaseAt?: IsoDateTimeString | null;
  createdAt?: IsoDateTimeString;
  updatedAt?: IsoDateTimeString;
}

/** Sotuv qatori (snapshot). `unitCost`, `lineProfit` — FAQAT `products.read_cost`. */
export interface SaleItemDto {
  productId: string;
  productName: string;
  barcode: string | null;
  unit: ProductUnit;
  quantity: QuantityString;
  unitPrice: MoneyString;
  lineTotal: MoneyString;
  unitCost?: MoneyString;
  lineProfit?: MoneyString;
}

/** Sotuv (API §11; Phase 9 da mijoz xarid tarixi uchun). `totalCost`, `grossProfit` — FAQAT `products.read_cost`. */
export interface SaleDto {
  id: string;
  /** `S-000123` (A-25). */
  number: string;
  soldAt: IsoDateTimeString;
  user: UserRefDto;
  warehouse: { id: string; name: string };
  /** Sotuv paytidagi mijoz snapshot'i. */
  customer: { id: string; name: string; phone: string | null };
  itemsCount: number;
  totalQuantity: QuantityString;
  totalAmount: MoneyString;
  totalCost?: MoneyString;
  grossProfit?: MoneyString;
  status: 'COMPLETED';
  items?: SaleItemDto[];
}

/** `GET /sales` yig'masi — filtr bo'yicha (sahifadan qat'i nazar). `totalCost`, `grossProfit` — FAQAT `products.read_cost`. */
export interface SalesSummary {
  count: number;
  totalQuantity: QuantityString;
  totalAmount: MoneyString;
  totalCost?: MoneyString;
  grossProfit?: MoneyString;
}

export interface SalesListResponse extends Paginated<SaleDto> {
  summary: SalesSummary;
}

/** `GET /customers/:id/purchases` — mijozning sotuvlari va yig'masi (REQ-080). */
export interface CustomerPurchasesResponse extends Paginated<SaleDto> {
  summary: {
    purchaseCount: number;
    totalSpent: MoneyString;
    lastPurchaseAt: IsoDateTimeString | null;
  };
}

/**
 * Xarajat kategoriyasi (API §12, D-19). `expenses.manage`siz user (sotuvchi — faqat
 * `expenses.create`) faqat faol kategoriyalarning `id, name` ini oladi — qolgan kalitlar umuman yo'q.
 */
export interface ExpenseCategoryDto {
  id: string;
  name: string;
  isActive?: boolean;
  /** Bog'langan xarajatlar soni (soft-delete qilinganlari ham — FK). `0` bo'lsa o'chirish mumkin (BR-31). */
  expenseCount?: number;
  createdAt?: IsoDateTimeString;
  updatedAt?: IsoDateTimeString;
}

/** Xarajat (API §12). Kategoriya majburiy (D-19), holat yo'q (D-11). */
export interface ExpenseDto {
  id: string;
  date: DateOnlyString;
  amount: MoneyString;
  category: { id: string; name: string };
  note: string | null;
  createdBy: UserRefDto;
  createdAt: IsoDateTimeString;
  updatedAt: IsoDateTimeString;
}

/** `GET /expenses` — ro'yxat va butun filtr bo'yicha yig'ma (soft-delete qilinganlarsiz). */
export interface ExpensesListResponse extends Paginated<ExpenseDto> {
  summary: { count: number; totalAmount: MoneyString };
}

// ─── Dashboard, hisobotlar, sozlamalar (Phase 12) ───────────────────────────

/** `GET /dashboard/summary` (API §14, §18; REQ-030, REQ-031) — kesh yo'q, so'rov paytida hisoblanadi. */
export interface DashboardSummaryDto {
  asOf: IsoDateTimeString;
  /** Toshkent kuni. */
  businessDate: DateOnlyString;
  today: { soldQuantity: QuantityString; salesAmount: MoneyString; salesCount: number };
  yesterday: { salesAmount: MoneyString };
  allTime: { soldQuantity: QuantityString; salesAmount: MoneyString; salesCount: number };
  warehouse: {
    totalQuantity: QuantityString;
    byUnit: { unit: ProductUnit; quantity: QuantityString }[];
    /** Qoldig'i 0 dan katta mahsulotlar soni. */
    productCount: number;
  };
  lowStock: {
    count: number;
    items: {
      productId: string;
      name: string;
      unit: ProductUnit;
      stock: QuantityString;
      threshold: QuantityString;
    }[];
  };
  users: { active: number; total: number; soldToday: number };
}

/** `GET /dashboard/my-summary` (API §14, OWN-08) — faqat o'z sotuvlari, bugun. */
export interface MyDashboardSummaryDto {
  businessDate: DateOnlyString;
  today: { salesCount: number; soldQuantity: QuantityString; salesAmount: MoneyString };
  warehouses: { id: string; name: string }[];
}

export interface SalesTrendPoint {
  date: DateOnlyString;
  amount: MoneyString;
  count: number;
}

export interface TopProductDto {
  productId: string;
  name: string;
  unit: ProductUnit;
  quantity: QuantityString;
  amount: MoneyString;
}

/** `GET /reports/<path>` — yagona shakl (API §13, §18). */
export interface ReportResponse {
  columns: ReportColumn[];
  data: Record<string, string | number | null>[];
  meta: Paginated<unknown>['meta'];
  summary: ReportSummaryItem[];
  /** Guruhlangan yig'ma (xarajatlar — kategoriya bo'yicha). */
  groups?: ReportGroupItem[];
}

/**
 * `GET /reports/finance-summary` (REQ-103, BUSINESS-RULES §4). Tannarxga bog'liq kalitlar faqat
 * `products.read_cost` bilan. Ombor tanlansa `expenses` va `netProfit` — `null` (D-21).
 */
export interface FinanceSummaryDto {
  period: { dateFrom: DateOnlyString; dateTo: DateOnlyString };
  warehouseId: string | null;
  salesCount: number;
  revenue: MoneyString;
  costOfGoodsSold?: MoneyString;
  grossProfit?: MoneyString;
  expenses: MoneyString | null;
  netProfit?: MoneyString | null;
  incomingPurchases?: MoneyString;
  inventoryValueAtCost?: MoneyString;
}

/** `GET /settings` (API §16, D-21). */
export interface SettingsDto {
  companyName: string;
  lowStockDefaultThreshold: QuantityString;
  currencyLabel: string;
}

/** Audit jurnali yozuvi (API §15, Phase 13). Faqat o'qish — yozish/o'zgartirish endpointi yo'q (D-06). */
export interface AuditLogDto {
  id: string;
  occurredAt: IsoDateTimeString;
  /** `null` — tizim yoki noma'lum (masalan, muvaffaqiyatsiz login). */
  actor: { id: string; login: string; fullName: string | null } | null;
  action: AuditAction;
  entityType: AuditEntityType;
  entityId: string | null;
  /** Parol, hash va token hech qachon bo'lmaydi (yozishda olib tashlanadi). */
  metadata: Record<string, unknown>;
  ip: string | null;
  requestId: string | null;
}

/** `GET /audit-logs` — cursor pagination: `nextCursor` — keyingi sahifa (`null` — oxiri). */
export interface AuditLogPage {
  data: AuditLogDto[];
  nextCursor: string | null;
}

/** `GET /health` javobi. */
export interface HealthResponse {
  status: 'ok' | 'degraded';
  checks: {
    database: 'up' | 'down';
    redis: 'up' | 'down';
  };
  version: string;
  timestamp: IsoDateTimeString;
}
