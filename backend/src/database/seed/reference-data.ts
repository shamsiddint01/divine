import { Permission, RoleCode } from '@divine/shared';

/**
 * Tizim uchun majburiy ma'lumotnoma yozuvlari (docs/DATABASE.md §9).
 * Permission kodlari va rol → permission xaritasi `@divine/shared`dan olinadi (RBAC'ning yagona manbai);
 * bu yerda faqat DB'ga yoziladigan o'zbekcha nom va tavsiflar.
 */

export const ROLE_NAMES: Readonly<Record<RoleCode, string>> = {
  [RoleCode.ADMIN]: 'Administrator',
  [RoleCode.USER]: 'Foydalanuvchi',
};

/** docs/RBAC.md §2 katalogidagi tavsiflar. `Record<Permission, …>` yangi permission tavsifsiz qolishiga yo'l qo'ymaydi. */
export const PERMISSION_DESCRIPTIONS: Readonly<Record<Permission, string>> = {
  [Permission.USERS_READ]: 'Userlar ro‘yxatini ko‘rish',
  [Permission.USERS_MANAGE]:
    'User yaratish, tahrirlash, bloklash, parolni yangilash, omborga biriktirish',
  [Permission.PRODUCT_GROUPS_READ]: 'Mahsulot guruhlari ro‘yxati (filtr uchun)',
  [Permission.PRODUCT_GROUPS_MANAGE]: 'Guruh yaratish, tahrirlash, o‘chirish',
  [Permission.PRODUCTS_READ]: 'Mahsulotlarni qidirish va ko‘rish (sotuv narxi, qoldiq)',
  [Permission.PRODUCTS_READ_COST]: 'Kelgan narxi, jami kirim, foyda ma’lumotlarini ko‘rish',
  [Permission.PRODUCTS_MANAGE]: 'Mahsulot yaratish, tahrirlash, arxivlash',
  [Permission.WAREHOUSES_READ]: 'Biriktirilgan omborlar ro‘yxati',
  [Permission.WAREHOUSES_READ_ALL]: 'Barcha omborlar, ombor detali, harakatlar',
  [Permission.WAREHOUSES_MANAGE]: 'Ombor yaratish, tahrirlash, faolsizlantirish',
  [Permission.INVENTORY_READ]: 'Inventar harakatlari (ledger)',
  [Permission.INVENTORY_RECONCILE]: 'Qoldiq va ledger solishtiruvi',
  [Permission.INCOMING_READ]: 'Kirimlarni ko‘rish',
  [Permission.INCOMING_MANAGE]: 'Kirim yaratish, tahrirlash (DRAFT), bekor qilish',
  [Permission.INCOMING_CONFIRM]: 'Kirimni tasdiqlash (qoldiq oshadi)',
  [Permission.SALES_CREATE]: 'Sotuv yaratish',
  [Permission.SALES_READ_OWN]: 'O‘z sotuvlarini ko‘rish',
  [Permission.SALES_READ_ALL]: 'Barcha sotuvlarni ko‘rish',
  [Permission.CUSTOMERS_READ]: 'Mijozlarni qidirish (sotuv uchun)',
  [Permission.CUSTOMERS_CREATE]: 'Mijoz yaratish (sotuv vaqtida)',
  [Permission.CUSTOMERS_MANAGE]: 'Mijozni tahrirlash',
  [Permission.CUSTOMERS_READ_HISTORY]: 'Mijoz xarid tarixi va yig‘ma ma’lumotlari',
  [Permission.EXPENSES_READ]: 'Xarajatlarni ko‘rish',
  [Permission.EXPENSES_CREATE]: 'Yangi xarajat qo‘shish (ro‘yxatsiz)',
  [Permission.EXPENSES_MANAGE]: 'Xarajat va kategoriyalarni boshqarish',
  [Permission.REPORTS_READ]: 'Barcha hisobotlar',
  [Permission.DASHBOARD_ADMIN]: 'Admin dashboard ko‘rsatkichlari',
  [Permission.DASHBOARD_OWN]: 'O‘zining bugungi sotuv ko‘rsatkichlari',
  [Permission.AUDIT_READ]: 'Audit jurnalini ko‘rish',
  [Permission.SETTINGS_READ]: 'Sozlamalarni ko‘rish',
  [Permission.SETTINGS_MANAGE]: 'Sozlamalarni o‘zgartirish',
};

/**
 * Tasdiqlangan standart sozlamalar (A-15, A-20). Seed ularni faqat YO'Q bo'lsa yozadi —
 * admin o'zgartirgan qiymat qayta seed'da ustidan yozilmaydi. Miqdor — string (NUMERIC aniqligi).
 */
export const DEFAULT_SETTINGS = {
  company_name: 'Divine.uz',
  low_stock_default_threshold: '5',
  currency_label: 'so‘m',
} as const satisfies Record<string, string>;
