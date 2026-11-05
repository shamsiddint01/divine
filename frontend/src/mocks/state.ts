import type {
  AuditAction,
  AuditEntityType,
  CreditInstallment,
  IncomingStatus,
  ProductStatus,
  ProductUnit,
  RoleCode,
  SalePriceType,
  UserStatus,
  WarehouseStatus,
} from '@divine/shared';

// Mock "ma'lumotlar bazasi" qatorlari — DATABASE.md jadvallarining soddalashtirilgan aksi.
// Handler'lar bu qatorlardan API DTO'larini quradi (backenddagi repository → mapper kabi).

export interface GroupRow {
  id: string;
  name: string;
  description: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ProductRow {
  id: string;
  name: string;
  groupId: string;
  barcode: string | null;
  costPrice: string;
  salePrice: string | null;
  wholesalePrice: string | null;
  unit: ProductUnit;
  allowDecimal: boolean;
  minStock: string | null;
  status: ProductStatus;
  createdAt: string;
  updatedAt: string;
}

export interface WarehouseRow {
  id: string;
  name: string;
  address: string | null;
  status: WarehouseStatus;
  createdAt: string;
  updatedAt: string;
}

export interface UserRow {
  id: string;
  login: string;
  fullName: string | null;
  role: RoleCode;
  status: UserStatus;
  warehouseIds: string[];
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CustomerRow {
  id: string;
  name: string;
  phone: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SaleItemRow {
  productId: string;
  quantity: string;
  unitPrice: string;
  unitCost: string;
}

export interface SaleRow {
  id: string;
  number: number;
  soldAt: string;
  userId: string;
  warehouseId: string;
  customerId: string;
  customerName: string;
  customerPhone: string | null;
  /** Dona yoki optom (D-25). */
  priceType: SalePriceType;
  items: SaleItemRow[];
  totalQuantity: string;
  totalAmount: string;
  totalCost: string;
  idempotencyKey: string | null;
  /** Kanonik payload xeshi (backend `request_hash` aksi); eski demo yozuvlarida yo'q. */
  requestHash?: string;
}

export interface IncomingItemRow {
  id: string;
  productId: string;
  /** Snapshot (D-08); eski demo yozuvlarida yo'q — joriy mahsulot ko'rsatiladi. */
  productName?: string;
  barcode?: string | null;
  quantity: string;
  costPrice: string;
}

export interface IncomingRow {
  id: string;
  number: number;
  date: string;
  warehouseId: string;
  notes: string | null;
  status: IncomingStatus;
  items: IncomingItemRow[];
  createdBy: string;
  confirmedBy: string | null;
  confirmedAt: string | null;
  /** Phase 8 dan oldingi demo yozuvlarida yo'q bo'lishi mumkin. */
  cancelledBy?: string | null;
  cancelledAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MovementRow {
  id: number;
  warehouseId: string;
  productId: string;
  type: 'INCOMING' | 'SALE';
  /** Ishorali: kirim +, sotuv − */
  quantity: string;
  balanceAfter: string;
  referenceId: string;
  referenceNumber: string;
  userId: string;
  createdAt: string;
}

export interface CreditPaymentRow {
  id: string;
  date: string;
  amount: string;
  note: string | null;
  createdBy: string;
  createdAt: string;
}

export interface CreditRow {
  id: string;
  number: number;
  debtorName: string;
  debtorPhone: string;
  amount: string;
  takenAt: string;
  note: string | null;
  /** Kassadan yozilgan bo'lsa (D-26). */
  saleId?: string | null;
  installments: CreditInstallment[];
  payments: CreditPaymentRow[];
  createdBy: string;
  createdAt: string;
}

export interface ExpenseCategoryRow {
  id: string;
  name: string;
  isActive: boolean;
  /** Kim qo'shgan (D-23). Eski demo yozuvlarida yo'q — birinchi ADMIN qo'shgan hisoblanadi. */
  createdBy?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ExpenseRow {
  id: string;
  date: string;
  amount: string;
  /** Majburiy (D-19). */
  categoryId: string;
  note: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  updatedBy?: string | null;
  deletedAt: string | null;
  deletedBy?: string | null;
}

/** `audit_logs` aksi (Phase 13): faqat qo'shiladi, o'zgartirilmaydi. Mock'da IP va so'rov ID yo'q. */
export interface AuditRow {
  id: number;
  occurredAt: string;
  actorId: string | null;
  action: AuditAction;
  entityType: AuditEntityType;
  entityId: string | null;
  metadata: Record<string, unknown>;
}

/** API §16, D-21: faqat 3 ta maydon (backend `settings` jadvali bilan bir xil). */
export interface SettingsRow {
  companyName: string;
  lowStockDefaultThreshold: string;
  currencyLabel: string;
}

export interface MockState {
  version: number;
  seededAt: string;
  /** Foydalanuvchi demo ma'lumotlarni o'zgartirganmi (sotuv, kirim, ...). */
  dirty: boolean;
  /** Mock sessiya: kirgan user (bo'sh — tizimdan chiqilgan). */
  currentUserId: string;
  /**
   * Faqat demo: mock'da yaratilgan/tiklangan userlarning 6 xonali paroli (login'ni sinash uchun).
   * Seed userlar uchun yo'q — ular `MOCK_DEMO_PASSWORD` bilan kiradi. Haqiqiy backend'da faqat hash.
   */
  passwords?: Record<string, string>;
  groups: GroupRow[];
  products: ProductRow[];
  warehouses: WarehouseRow[];
  /** `${warehouseId}|${productId}` → qoldiq (warehouse_stock) */
  stock: Record<string, string>;
  movements: MovementRow[];
  users: UserRow[];
  customers: CustomerRow[];
  sales: SaleRow[];
  incoming: IncomingRow[];
  expenseCategories: ExpenseCategoryRow[];
  expenses: ExpenseRow[];
  credits: CreditRow[];
  settings: SettingsRow;
  audit: AuditRow[];
  counters: { sale: number; incoming: number; movement: number; audit: number; credit: number };
}

export const STATE_VERSION = 11;

export const stockKey = (warehouseId: string, productId: string) => `${warehouseId}|${productId}`;
