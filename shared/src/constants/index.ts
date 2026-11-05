/** Biznes vaqt zonasi: "bugun", kunlik hisobotlar va UI ko'rinishi shu zona bo'yicha (REQ-165). */
export const APP_TIMEZONE = 'Asia/Tashkent';

/** Barcha REST endpointlari uchun prefiks (REQ-140). */
export const API_PREFIX = 'api/v1';

/** Pul summalari: NUMERIC(18,2). */
export const MONEY_SCALE = 2;
export const MONEY_MAX_INTEGER_DIGITS = 16;

/** Miqdorlar: NUMERIC(14,3) — kasr miqdorli mahsulotlar (kg, litr) uchun. */
export const QUANTITY_SCALE = 3;
export const QUANTITY_MAX_INTEGER_DIGITS = 11;

/** Login qoidalari (BR-03, A-05). */
export const LOGIN_MIN_LENGTH = 3;
export const LOGIN_MAX_LENGTH = 32;
export const LOGIN_PATTERN = /^[A-Za-z0-9]+$/;

/** Generatsiya qilinadigan parol: aynan 6 ta raqam (BR-04). */
export const GENERATED_PASSWORD_LENGTH = 6;
export const GENERATED_PASSWORD_PATTERN = /^\d{6}$/;

/** Server-side pagination chegaralari (REQ-091). */
export const PAGINATION_DEFAULT_PAGE_SIZE = 20;
export const PAGINATION_MAX_PAGE_SIZE = 100;

/** Matn maydonlari uzunligi. */
export const PERSON_NAME_MAX_LENGTH = 150;
export const ENTITY_NAME_MAX_LENGTH = 200;
export const BARCODE_MAX_LENGTH = 64;
export const NOTE_MAX_LENGTH = 1000;
/** `expense_categories.name` — VARCHAR(100). */
export const EXPENSE_CATEGORY_NAME_MAX_LENGTH = 100;

/** Sotuv uchun idempotency header nomi (REQ-145). */
export const IDEMPOTENCY_HEADER = 'Idempotency-Key';

/** UI'da valyuta belgisi. */
export const CURRENCY_LABEL = 'so‘m';

/** Nasiyani bo'lib to'lash chegaralari (D-24). */
export const CREDIT_INSTALLMENTS_MAX = 365;
export const CREDIT_INTERVAL_DAYS_MAX = 365;
