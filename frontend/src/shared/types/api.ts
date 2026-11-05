// API javob tiplari — docs/API.md contract'ining frontenddagi aksi.
// Mock API (src/mocks) ham, kelajakdagi real backend ham AYNAN shu shakllarni qaytaradi,
// shuning uchun backend ulanganda feature kodi o'zgarmaydi. Backend phase'larida bu tiplar
// @divine/shared ga ko'chiriladi.
import type {
  MoneyString,
  Paginated,
  ProductStatus,
  ProductUnit,
  QuantityString,
  RoleCode,
  UserStatus,
} from '@divine/shared';

export type { Paginated };
export type Money = MoneyString;
export type Quantity = QuantityString;
export type IsoDateTime = string;
export type DateOnly = string;

export interface Ref {
  id: string;
  name: string;
}

export interface UserRef {
  id: string;
  login: string;
  fullName: string | null;
}

// ─── Session ────────────────────────────────────────────────────────────────

export interface CurrentUserDto {
  id: string;
  login: string;
  fullName: string | null;
  role: RoleCode;
  status: UserStatus;
  permissions: string[];
  warehouseIds: string[];
}

// ─── Mahsulot guruhlari ─────────────────────────────────────────────────────

export type {
  ProductDto,
  ProductGroupDto,
  ProductSaleRow,
  ProductStockByWarehouse,
  ProductSummaryDto,
} from '@divine/shared';

export interface ProductGroupInput {
  name?: string;
  description?: string | null;
  /** `false` — arxivlash (PATCH). */
  isActive?: boolean;
}

// ─── Mahsulotlar ────────────────────────────────────────────────────────────

export interface ProductInput {
  name: string;
  groupId: string;
  barcode?: string | null;
  costPrice: Money;
  /** Dona va optom narxidan kamida bittasi (D-25). */
  salePrice: Money | null;
  wholesalePrice: Money | null;
  unit: ProductUnit;
  allowDecimal: boolean;
  minStock?: Quantity | null;
  status: ProductStatus;
  /** Faqat yaratishda: boshlang'ich qoldiq (kelgan narxi — `costPrice`). */
  initialStock?: Omit<StockReceiptInput, 'costPrice'>;
}

// ─── Omborlar ───────────────────────────────────────────────────────────────

export type {
  MovementDto,
  StockRowDto,
  WarehouseDetailDto,
  WarehouseDto,
  WarehouseListItemDto,
  WarehouseStats,
} from '@divine/shared';

export interface WarehouseInput {
  name: string;
  address?: string | null;
}

// ─── Mijozlar ───────────────────────────────────────────────────────────────

export type { CustomerDto, CustomerPurchasesResponse } from '@divine/shared';

export interface CustomerInput {
  name: string;
  phone?: string | null;
  notes?: string | null;
}

// ─── Sotuvlar ───────────────────────────────────────────────────────────────

export type { SaleDto, SaleItemDto } from '@divine/shared';

export type { SalesListResponse, SalesSummary } from '@divine/shared';

export interface CreateSaleInput {
  warehouseId: string;
  /** Ism ixtiyoriy: bo'sh yoki `null` — server umumiy "Noma’lum mijoz"ga yozadi. */
  customer: { id: string } | { name?: string | null; phone?: string | null };
  /** Dona yoki optom (D-25); narxning o'zini server kartochkadan oladi. */
  priceType: SalePriceType;
  items: { productId: string; quantity: Quantity }[];
}

// ─── Qoldiq qo'shish (sobiq Kirim) ──────────────────────────────────────────

export interface StockReceiptInput {
  warehouseId: string;
  quantity: Quantity;
  costPrice: Money;
  date: DateOnly;
  notes?: string | null;
}

// ─── Xarajatlar ─────────────────────────────────────────────────────────────

export type { ExpenseCategoryDto, ExpenseDto, ExpensesListResponse } from '@divine/shared';

export interface ExpenseInput {
  date: DateOnly;
  amount: Money;
  /** Majburiy (D-19). */
  categoryId: string;
  note?: string | null;
}

// ─── Userlar ────────────────────────────────────────────────────────────────

export type { PasswordResetResponse, UserDto, WarehouseOption } from '@divine/shared';

export interface UserInput {
  login: string;
  fullName?: string | null;
  role: RoleCode;
  warehouseIds: string[];
}

export type { UserCreatedResponse } from '@divine/shared';

// ─── Dashboard, hisobotlar, sozlamalar (Phase 12 — shared'dan) ───────────────

export type {
  DashboardSummaryDto,
  FinanceSummaryDto,
  MyDashboardSummaryDto,
  ReportCellKind,
  ReportColumn,
  ReportGroupItem,
  ReportResponse,
  ReportSummaryItem,
  ReportType,
  SalesTrendPoint,
  SettingsDto,
  TopProductDto,
} from '@divine/shared';

// ─── Audit jurnali (Phase 13 — shared'dan) ───────────────────────────────────

export type { AuditLogDto, AuditLogPage } from '@divine/shared';
