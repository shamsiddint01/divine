import type { ProductUnit } from '@divine/shared';
import { lineTotal, sumMoney, sumQty } from '@/shared/lib/decimal';
import { todayInTashkent } from '@/shared/lib/format';
import { formatDocNumber, getStock, postMovement } from './inventory';
import { addDays, atTashkent } from './lib/time';
import { type Random, createRandom, ean13, mockUuid } from './lib/random';
import {
  type CustomerRow,
  type ExpenseRow,
  type IncomingRow,
  type MockState,
  type ProductRow,
  STATE_VERSION,
  type SaleItemRow,
  type UserRow,
} from './state';

// Deterministik demo ma'lumotlar: 75 kunlik savdo tarixi. Kirim va sotuvlar xronologik
// tartibda ledger orqali o'tkaziladi — shuning uchun qoldiq, harakatlar, dashboard va
// hisobotlar o'zaro DOIM mos keladi.

const SEED = 20261006;
const HISTORY_DAYS = 75;

const GROUPS = [
  ['smart', 'Smartfonlar', 'Mobil telefonlar va planshetlar'],
  ['audio', 'Audio va quloqchinlar', 'Naushniklar, kolonkalar'],
  ['cable', 'Kabel va zaryadlovchilar', 'Kabellar, adapterlar, powerbanklar'],
  ['pc', 'Kompyuter aksessuarlari', 'Sichqoncha, klaviatura, xotira qurilmalari'],
  ['home', 'Maishiy texnika', 'Kichik maishiy texnika'],
  ['food', 'Oziq-ovqat', 'Tarozida va donalab sotiladigan mahsulotlar'],
  ['house', 'Xo‘jalik mollari', 'Tozalash va gigiyena vositalari'],
  ['office', 'Kanselyariya', 'Ofis va maktab mollari'],
] as const;

type GroupKey = (typeof GROUPS)[number][0];

interface CatalogItem {
  name: string;
  group: GroupKey;
  unit: ProductUnit;
  cost: number;
  sale: number;
  min: number;
  /** Sotuv ehtimoli og'irligi */
  weight: number;
  /** Boshlang'ich kirim (asosiy ombor uchun) */
  stock: number;
  noBarcode?: boolean;
  /** Qayta kirim qilinmaydi — oxirida kam qoladi (dashboard'dagi "kam qolgan" ro'yxati uchun). */
  neglected?: boolean;
}

const CATALOG: CatalogItem[] = [
  {
    name: 'Telefon Redmi 13 128GB',
    group: 'smart',
    unit: 'DONA',
    cost: 1_850_000,
    sale: 2_190_000,
    min: 5,
    weight: 6,
    stock: 40,
  },
  {
    name: 'Telefon Samsung Galaxy A15',
    group: 'smart',
    unit: 'DONA',
    cost: 2_100_000,
    sale: 2_490_000,
    min: 4,
    weight: 5,
    stock: 30,
  },
  {
    name: 'Telefon iPhone 13 128GB',
    group: 'smart',
    unit: 'DONA',
    cost: 7_400_000,
    sale: 8_290_000,
    min: 2,
    weight: 2,
    stock: 10,
    neglected: true,
  },
  {
    name: 'Telefon Honor X6b',
    group: 'smart',
    unit: 'DONA',
    cost: 1_450_000,
    sale: 1_790_000,
    min: 4,
    weight: 4,
    stock: 25,
  },
  {
    name: 'Telefon Tecno Spark 20',
    group: 'smart',
    unit: 'DONA',
    cost: 1_300_000,
    sale: 1_590_000,
    min: 3,
    weight: 3,
    stock: 20,
  },
  {
    name: 'Telefon Redmi Note 13 Pro',
    group: 'smart',
    unit: 'DONA',
    cost: 3_300_000,
    sale: 3_890_000,
    min: 3,
    weight: 3,
    stock: 18,
  },
  {
    name: 'Naushnik Xiaomi Redmi Buds 6',
    group: 'audio',
    unit: 'DONA',
    cost: 210_000,
    sale: 299_000,
    min: 8,
    weight: 6,
    stock: 60,
  },
  {
    name: 'Naushnik JBL Tune 520BT',
    group: 'audio',
    unit: 'DONA',
    cost: 420_000,
    sale: 579_000,
    min: 5,
    weight: 3,
    stock: 30,
  },
  {
    name: 'Naushnik simli Hoco M1',
    group: 'audio',
    unit: 'DONA',
    cost: 18_000,
    sale: 35_000,
    min: 20,
    weight: 5,
    stock: 150,
  },
  {
    name: 'Kolonka JBL Go 4',
    group: 'audio',
    unit: 'DONA',
    cost: 330_000,
    sale: 449_000,
    min: 4,
    weight: 2,
    stock: 20,
    neglected: true,
  },
  {
    name: 'Naushnik AirPods 3',
    group: 'audio',
    unit: 'DONA',
    cost: 1_750_000,
    sale: 2_090_000,
    min: 2,
    weight: 1,
    stock: 8,
  },
  {
    name: 'Kabel USB-C 1 m',
    group: 'cable',
    unit: 'DONA',
    cost: 12_000,
    sale: 25_000,
    min: 30,
    weight: 9,
    stock: 300,
  },
  {
    name: 'Kabel Lightning 1 m',
    group: 'cable',
    unit: 'DONA',
    cost: 15_000,
    sale: 30_000,
    min: 25,
    weight: 6,
    stock: 200,
  },
  {
    name: 'Kabel Micro-USB 1 m',
    group: 'cable',
    unit: 'DONA',
    cost: 8_000,
    sale: 18_000,
    min: 20,
    weight: 3,
    stock: 150,
  },
  {
    name: 'Zaryadlovchi 20W USB-C',
    group: 'cable',
    unit: 'DONA',
    cost: 65_000,
    sale: 119_000,
    min: 10,
    weight: 6,
    stock: 90,
  },
  {
    name: 'Zaryadlovchi 65W GaN',
    group: 'cable',
    unit: 'DONA',
    cost: 190_000,
    sale: 289_000,
    min: 5,
    weight: 2,
    stock: 25,
  },
  {
    name: 'Powerbank 10000 mAh',
    group: 'cable',
    unit: 'DONA',
    cost: 140_000,
    sale: 219_000,
    min: 6,
    weight: 4,
    stock: 45,
    neglected: true,
  },
  {
    name: 'Sichqoncha Logitech M190',
    group: 'pc',
    unit: 'DONA',
    cost: 95_000,
    sale: 149_000,
    min: 6,
    weight: 4,
    stock: 40,
  },
  {
    name: 'Sichqoncha simli A4Tech',
    group: 'pc',
    unit: 'DONA',
    cost: 45_000,
    sale: 79_000,
    min: 8,
    weight: 3,
    stock: 50,
  },
  {
    name: 'Klaviatura Logitech K120',
    group: 'pc',
    unit: 'DONA',
    cost: 110_000,
    sale: 169_000,
    min: 4,
    weight: 2,
    stock: 25,
  },
  {
    name: 'Fleshka Kingston 64GB',
    group: 'pc',
    unit: 'DONA',
    cost: 55_000,
    sale: 89_000,
    min: 10,
    weight: 4,
    stock: 70,
  },
  {
    name: 'Xotira kartasi microSD 128GB',
    group: 'pc',
    unit: 'DONA',
    cost: 95_000,
    sale: 149_000,
    min: 6,
    weight: 3,
    stock: 40,
    neglected: true,
  },
  {
    name: 'Veb-kamera 1080p',
    group: 'pc',
    unit: 'DONA',
    cost: 230_000,
    sale: 339_000,
    min: 2,
    weight: 1,
    stock: 10,
  },
  {
    name: 'Elektr choynak Artel 1,7 l',
    group: 'home',
    unit: 'DONA',
    cost: 190_000,
    sale: 279_000,
    min: 3,
    weight: 3,
    stock: 25,
  },
  {
    name: 'Dazmol Philips GC1740',
    group: 'home',
    unit: 'DONA',
    cost: 320_000,
    sale: 449_000,
    min: 3,
    weight: 2,
    stock: 15,
  },
  {
    name: 'Fen Rowenta CV1712',
    group: 'home',
    unit: 'DONA',
    cost: 260_000,
    sale: 369_000,
    min: 3,
    weight: 2,
    stock: 15,
    neglected: true,
  },
  {
    name: 'Blender Vitek VT-8516',
    group: 'home',
    unit: 'DONA',
    cost: 380_000,
    sale: 529_000,
    min: 2,
    weight: 1,
    stock: 12,
  },
  {
    name: 'Changyutgich Samsung 2000W',
    group: 'home',
    unit: 'DONA',
    cost: 1_150_000,
    sale: 1_490_000,
    min: 2,
    weight: 1,
    stock: 8,
  },
  {
    name: 'Guruch Lazer',
    group: 'food',
    unit: 'KG',
    cost: 22_000,
    sale: 28_000,
    min: 50,
    weight: 7,
    stock: 500,
    noBarcode: true,
  },
  {
    name: 'Shakar',
    group: 'food',
    unit: 'KG',
    cost: 12_500,
    sale: 15_000,
    min: 50,
    weight: 6,
    stock: 400,
    noBarcode: true,
  },
  {
    name: 'Un oliy nav',
    group: 'food',
    unit: 'KG',
    cost: 6_500,
    sale: 8_500,
    min: 80,
    weight: 5,
    stock: 600,
    noBarcode: true,
  },
  {
    name: 'Kungaboqar yog‘i',
    group: 'food',
    unit: 'LITR',
    cost: 19_000,
    sale: 24_000,
    min: 40,
    weight: 5,
    stock: 300,
    noBarcode: true,
  },
  {
    name: 'Choy Ahmad qora 100 g',
    group: 'food',
    unit: 'DONA',
    cost: 28_000,
    sale: 36_000,
    min: 20,
    weight: 4,
    stock: 120,
  },
  {
    name: 'Makaron Makfa 400 g',
    group: 'food',
    unit: 'DONA',
    cost: 9_500,
    sale: 13_000,
    min: 30,
    weight: 5,
    stock: 200,
  },
  {
    name: 'Asal tog‘',
    group: 'food',
    unit: 'KG',
    cost: 85_000,
    sale: 120_000,
    min: 10,
    weight: 2,
    stock: 40,
    noBarcode: true,
    neglected: true,
  },
  {
    name: 'Kir yuvish kukuni Ariel 3 kg',
    group: 'house',
    unit: 'DONA',
    cost: 95_000,
    sale: 125_000,
    min: 10,
    weight: 3,
    stock: 60,
  },
  {
    name: 'Idish yuvish vositasi Fairy 900 ml',
    group: 'house',
    unit: 'DONA',
    cost: 24_000,
    sale: 32_000,
    min: 15,
    weight: 4,
    stock: 100,
  },
  {
    name: 'Sovun Duru 4 dona',
    group: 'house',
    unit: 'DONA',
    cost: 18_000,
    sale: 25_000,
    min: 20,
    weight: 3,
    stock: 120,
  },
  {
    name: 'Tualet qog‘ozi 12 dona',
    group: 'house',
    unit: 'DONA',
    cost: 38_000,
    sale: 52_000,
    min: 15,
    weight: 3,
    stock: 90,
  },
  {
    name: 'Arqon kanop',
    group: 'house',
    unit: 'METR',
    cost: 2_500,
    sale: 4_000,
    min: 50,
    weight: 1,
    stock: 400,
    noBarcode: true,
  },
  {
    name: 'Daftar 48 varaq',
    group: 'office',
    unit: 'DONA',
    cost: 3_500,
    sale: 6_000,
    min: 50,
    weight: 4,
    stock: 400,
  },
  {
    name: 'Ruchka Pilot ko‘k',
    group: 'office',
    unit: 'DONA',
    cost: 4_000,
    sale: 7_000,
    min: 50,
    weight: 4,
    stock: 400,
  },
  {
    name: 'A4 qog‘oz Svetocopy 500 varaq',
    group: 'office',
    unit: 'DONA',
    cost: 52_000,
    sale: 69_000,
    min: 10,
    weight: 3,
    stock: 80,
  },
  {
    name: 'Marker to‘plami 6 rang',
    group: 'office',
    unit: 'DONA',
    cost: 22_000,
    sale: 35_000,
    min: 10,
    weight: 2,
    stock: 60,
  },
  {
    name: 'Kalkulyator Casio MX-12B',
    group: 'office',
    unit: 'DONA',
    cost: 75_000,
    sale: 110_000,
    min: 3,
    weight: 1,
    stock: 20,
  },
];

const WAREHOUSES = [
  ['Asosiy ombor', 'Toshkent sh., Chilonzor tumani, Bunyodkor ko‘chasi 12', 1],
  ['Yunusobod filiali', 'Toshkent sh., Yunusobod tumani, 4-mavze, 18-uy', 0.55],
  ['Samarqand filiali', 'Samarqand sh., Registon ko‘chasi 7', 0.4],
] as const;

const USERS: {
  login: string;
  fullName: string;
  role: 'ADMIN' | 'USER';
  wh: number[];
  blocked?: boolean;
}[] = [
  { login: 'admin', fullName: 'Akmal Rahimov', role: 'ADMIN', wh: [0, 1, 2] },
  { login: 'sardor', fullName: 'Sardor Aliyev', role: 'ADMIN', wh: [0, 1, 2] },
  { login: 'aziz', fullName: 'Aziz Karimov', role: 'USER', wh: [0] },
  { login: 'dilnoza', fullName: 'Dilnoza Yusupova', role: 'USER', wh: [0, 1] },
  { login: 'jasur', fullName: 'Jasur Tojiyev', role: 'USER', wh: [1] },
  { login: 'malika', fullName: 'Malika Ergasheva', role: 'USER', wh: [2] },
  { login: 'bekzod', fullName: 'Bekzod Nazarov', role: 'USER', wh: [2], blocked: true },
];

const FIRST_NAMES = [
  'Aziz',
  'Gulnora',
  'Bobur',
  'Nilufar',
  'Sherzod',
  'Madina',
  'Otabek',
  'Zarina',
  'Rustam',
  'Kamola',
  'Jahongir',
  'Dildora',
  'Ulugbek',
  'Shahnoza',
  'Farrux',
  'Mohira',
  'Islom',
  'Sevara',
  'Doniyor',
  'Feruza',
  'Temur',
  'Nodira',
  'Behruz',
  'Lola',
  'Anvar',
  'Munisa',
  'Javlon',
  'Malohat',
  'Sanjar',
  'Yulduz',
];
const LAST_NAMES = [
  'Qodirov',
  'Saidov',
  'Abdullayev',
  'Rahimov',
  'Usmonov',
  'Ismoilov',
  'Xolmatov',
  'Nazarov',
  'Yo‘ldoshev',
  'Mirzayev',
  'Tursunov',
  'Sobirov',
  'Hamidov',
  'Ergashev',
  'Valiyev',
  'Jo‘rayev',
  'Karimov',
  'Sultonov',
];
const FEMININE = new Set([
  'Gulnora',
  'Nilufar',
  'Madina',
  'Zarina',
  'Kamola',
  'Dildora',
  'Shahnoza',
  'Mohira',
  'Sevara',
  'Feruza',
  'Nodira',
  'Lola',
  'Munisa',
  'Malohat',
  'Yulduz',
]);

const EXPENSE_CATEGORIES = [
  'Ijara',
  'Ish haqi',
  'Kommunal to‘lovlar',
  'Transport va yetkazib berish',
  'Reklama',
  'Soliqlar',
  'Xo‘jalik xarajatlari',
  'Boshqa',
];

const money = (n: number) => `${Math.round(n)}.00`;

function customerName(r: Random): string {
  const first = r.pick(FIRST_NAMES);
  const last = r.pick(LAST_NAMES);
  return `${first} ${FEMININE.has(first) ? `${last}a` : last}`;
}

function phone(r: Random): string {
  return `+998${r.pick(['90', '91', '93', '94', '95', '97', '98', '99', '33', '88'])}${String(r.int(1_000_000, 9_999_999))}`;
}

function quantityFor(r: Random, p: ProductRow): string {
  if (p.unit === 'KG') return (r.int(1, 10) / 2).toFixed(3);
  if (p.unit === 'LITR') return (r.int(2, 8) / 2).toFixed(3);
  if (p.unit === 'METR') return r.int(2, 15).toFixed(3);
  const cheap = Number(p.salePrice) < 60_000;
  return String(cheap ? r.int(1, 4) : r.chance(0.85) ? 1 : 2);
}

/** Boshlang'ich demo holat. `now` — test va tiklash uchun aniq vaqt berish mumkin. */
export function createSeedState(now: Date = new Date()): MockState {
  const r = createRandom(SEED);
  const id = () => mockUuid(r.next);
  const today = todayInTashkent(now);
  const startDay = addDays(today, -HISTORY_DAYS);
  const createdAt = atTashkent(addDays(startDay, -5), 10);

  const state: MockState = {
    version: STATE_VERSION,
    seededAt: now.toISOString(),
    dirty: false,
    currentUserId: '',
    groups: [],
    products: [],
    warehouses: [],
    stock: {},
    movements: [],
    users: [],
    customers: [],
    sales: [],
    incoming: [],
    expenseCategories: [],
    expenses: [],
    settings: {
      companyName: 'Divine Market',
      lowStockDefaultThreshold: '5',
      currencyLabel: 'so‘m',
    },
    audit: [],
    counters: { sale: 0, incoming: 0, movement: 0, audit: 0 },
  };

  // ── Lug'atlar ────────────────────────────────────────────────────────────
  const groupIds = new Map<GroupKey, string>();
  for (const [key, name, description] of GROUPS) {
    const gid = id();
    groupIds.set(key, gid);
    state.groups.push({
      id: gid,
      name,
      description,
      isActive: true,
      createdAt,
      updatedAt: createdAt,
    });
  }

  CATALOG.forEach((c, i) => {
    state.products.push({
      id: id(),
      name: c.name,
      groupId: groupIds.get(c.group) ?? '',
      barcode: c.noBarcode ? null : ean13(String(100_000_000 + i * 7919).slice(-9)),
      costPrice: money(c.cost),
      salePrice: money(c.sale),
      unit: c.unit,
      allowDecimal: c.unit !== 'DONA',
      minStock: `${c.min}.000`,
      status: 'ACTIVE',
      createdAt,
      updatedAt: createdAt,
    });
  });

  for (const [name, address] of WAREHOUSES) {
    state.warehouses.push({
      id: id(),
      name,
      address,
      status: 'ACTIVE',
      createdAt,
      updatedAt: createdAt,
    });
  }

  for (const u of USERS) {
    const row: UserRow = {
      id: id(),
      login: u.login,
      fullName: u.fullName,
      role: u.role,
      status: u.blocked ? 'BLOCKED' : 'ACTIVE',
      warehouseIds: u.wh.map((i) => state.warehouses[i]?.id ?? ''),
      lastLoginAt: null,
      createdAt,
      updatedAt: createdAt,
    };
    state.users.push(row);
  }
  const admin = state.users[0] as UserRow;
  state.currentUserId = admin.id;

  for (const name of EXPENSE_CATEGORIES) {
    const at = atTashkent(startDay, 9);
    state.expenseCategories.push({ id: id(), name, isActive: true, createdAt: at, updatedAt: at });
  }

  // Doimiy mijozlar bazasi
  for (let i = 0; i < 38; i++) {
    const at = atTashkent(addDays(startDay, r.int(0, 30)), r.int(9, 19));
    state.customers.push({
      id: id(),
      name: customerName(r),
      phone: r.chance(0.8) ? phone(r) : null,
      notes: null,
      createdAt: at,
      updatedAt: at,
    });
  }

  // ── Kirim yordamchisi ────────────────────────────────────────────────────
  const confirmIncoming = (
    warehouseIndex: number,
    date: string,
    lines: { product: ProductRow; quantity: string }[],
    notes: string | null,
  ) => {
    const warehouse = state.warehouses[warehouseIndex];
    if (!warehouse || lines.length === 0) return;
    state.counters.incoming += 1;
    const number = state.counters.incoming;
    const at = atTashkent(date, 9, r.int(0, 40));
    const doc: IncomingRow = {
      id: id(),
      number,
      date,
      warehouseId: warehouse.id,
      notes,
      status: 'CONFIRMED',
      items: lines.map((l) => ({
        id: id(),
        productId: l.product.id,
        quantity: l.quantity,
        costPrice: l.product.costPrice,
      })),
      createdBy: admin.id,
      confirmedBy: admin.id,
      confirmedAt: at,
      createdAt: at,
      updatedAt: at,
    };
    state.incoming.push(doc);
    for (const item of doc.items) {
      postMovement(state, {
        warehouseId: warehouse.id,
        productId: item.productId,
        type: 'INCOMING',
        quantity: item.quantity,
        referenceId: doc.id,
        referenceNumber: formatDocNumber('K', number),
        userId: admin.id,
        createdAt: at,
      });
    }
  };

  const suppliers = [
    '“Texno Savdo” MChJ',
    '“Mega Distribution”',
    '“Oziq-ovqat Ulgurji” MChJ',
    '“Ofis Market”',
    '“Elektron Olam”',
  ];

  // Boshlang'ich kirim: har bir omborga
  WAREHOUSES.forEach(([, , factor], wi) => {
    const lines = state.products
      .map((p, pi) => {
        const c = CATALOG[pi] as CatalogItem;
        // E'tiborsiz qoldirilganlar faqat asosiy omborda, oz miqdorda — oxirida "kam qolgan" bo'ladi.
        if (c.neglected) return wi === 0 ? { product: p, quantity: `${c.min * 3}.000` } : null;
        return { product: p, quantity: `${Math.round(Math.max(c.stock * factor, c.min + 1))}.000` };
      })
      .filter((l): l is { product: ProductRow; quantity: string } => l !== null);
    confirmIncoming(
      wi,
      startDay,
      lines,
      `Boshlang‘ich qoldiq. Yetkazib beruvchi: ${r.pick(suppliers)}`,
    );
  });

  // ── Kunma-kun: qayta kirim + sotuvlar ───────────────────────────────────
  const nowMs = now.getTime();
  const weights = CATALOG.map((c) => c.weight);
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  const pickProduct = () => {
    let x = r.next() * totalWeight;
    for (let i = 0; i < weights.length; i++) {
      x -= weights[i] ?? 0;
      if (x <= 0) return state.products[i] as ProductRow;
    }
    return state.products[0] as ProductRow;
  };

  for (let d = 1; d <= HISTORY_DAYS; d++) {
    const date = addDays(startDay, d);
    const isToday = date === today;

    // Har 8–11 kunda omborlarni to'ldirish (e'tiborsiz qoldirilgan mahsulotlardan tashqari)
    WAREHOUSES.forEach(([, , factor], wi) => {
      if ((d + wi * 3) % r.int(8, 11) !== 0 || isToday) return;
      const warehouse = state.warehouses[wi];
      if (!warehouse) return;
      const lines = state.products
        .map((p, pi) => ({ p, c: CATALOG[pi] as CatalogItem }))
        .filter(
          ({ p, c }) =>
            !c.neglected && Number(getStock(state, warehouse.id, p.id)) < c.stock * factor * 0.6,
        )
        .map(({ p, c }) => ({
          product: p,
          quantity: `${Math.max(Math.round(c.stock * factor * 0.7), c.min)}.000`,
        }));
      if (lines.length > 0)
        confirmIncoming(wi, date, lines, `Yetkazib beruvchi: ${r.pick(suppliers)}`);
    });

    // Sotuvlar soni: hafta oxiri ko'proq, vaqt o'tishi bilan biroz o'sish
    const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
    const base = weekday === 6 ? 16 : weekday === 0 ? 12 : 10;
    const count = Math.round(base * (0.8 + (d / HISTORY_DAYS) * 0.4)) + r.int(-3, 3);

    const times = Array.from(
      { length: Math.max(count, 2) },
      () => [r.int(9, 20), r.int(0, 59)] as const,
    ).sort((a, b) => a[0] * 60 + a[1] - (b[0] * 60 + b[1]));

    for (const [hour, minute] of times) {
      const soldAt = atTashkent(date, hour, minute);
      if (Date.parse(soldAt) > nowMs - 5 * 60_000) continue;

      const wi = r.next() < 0.5 ? 0 : r.next() < 0.6 ? 1 : 2;
      const warehouse = state.warehouses[wi];
      if (!warehouse) continue;
      // Bloklangan user faqat bloklanishidan oldin (so'nggi 12 kundan avval) sotuv qilgan.
      const sellers = state.users.filter(
        (u) =>
          u.warehouseIds.includes(warehouse.id) &&
          (u.role === 'USER' || r.chance(0.08)) &&
          (u.status === 'ACTIVE' || d < HISTORY_DAYS - 12),
      );
      const seller = r.pick(sellers.length > 0 ? sellers : [admin]);

      const itemCount = r.next() < 0.55 ? 1 : r.next() < 0.65 ? 2 : 3;
      const items: SaleItemRow[] = [];
      for (let k = 0; k < itemCount; k++) {
        const product = pickProduct();
        if (items.some((i) => i.productId === product.id)) continue;
        const available = Number(getStock(state, warehouse.id, product.id));
        let qty = quantityFor(r, product);
        if (Number(qty) > available) {
          if (available < 1) continue;
          qty = product.unit === 'DONA' ? String(Math.floor(available)) : available.toFixed(3);
        }
        items.push({
          productId: product.id,
          quantity: qty,
          unitPrice: product.salePrice,
          unitCost: product.costPrice,
        });
      }
      if (items.length === 0) continue;

      let customer: CustomerRow;
      if (r.chance(0.7) && state.customers.length > 0) {
        customer = r.pick(state.customers);
      } else {
        customer = {
          id: id(),
          name: customerName(r),
          phone: r.chance(0.6) ? phone(r) : null,
          notes: null,
          createdAt: soldAt,
          updatedAt: soldAt,
        };
        state.customers.push(customer);
      }

      state.counters.sale += 1;
      const number = state.counters.sale;
      const saleId = id();
      for (const item of items) {
        postMovement(state, {
          warehouseId: warehouse.id,
          productId: item.productId,
          type: 'SALE',
          quantity: `-${item.quantity}`,
          referenceId: saleId,
          referenceNumber: formatDocNumber('S', number),
          userId: seller.id,
          createdAt: soldAt,
        });
      }
      state.sales.push({
        id: saleId,
        number,
        soldAt,
        userId: seller.id,
        warehouseId: warehouse.id,
        customerId: customer.id,
        customerName: customer.name,
        customerPhone: customer.phone,
        items,
        totalQuantity: sumQty(items.map((i) => i.quantity)),
        totalAmount: sumMoney(items.map((i) => lineTotal(i.quantity, i.unitPrice))),
        totalCost: sumMoney(items.map((i) => lineTotal(i.quantity, i.unitCost))),
        idempotencyKey: null,
      });
      if (seller.lastLoginAt === null || seller.lastLoginAt < soldAt) seller.lastLoginAt = soldAt;
    }
  }

  // ── Bugungi qoralama kirim (TZ misoli: 50 + 30 + 100 + 20 = 200) ─────────
  const byName = (name: string) => state.products.find((p) => p.name === name) as ProductRow;
  const draftAt = new Date(nowMs - 40 * 60_000).toISOString();
  state.counters.incoming += 1;
  state.incoming.push({
    id: id(),
    number: state.counters.incoming,
    date: today,
    warehouseId: state.warehouses[0]?.id ?? '',
    notes: 'Yetkazib beruvchi: “Texno Savdo” MChJ, yuk xati №4521',
    status: 'DRAFT',
    items: [
      ['Telefon Redmi 13 128GB', '50'],
      ['Naushnik Xiaomi Redmi Buds 6', '30'],
      ['Kabel USB-C 1 m', '100'],
      ['Sichqoncha Logitech M190', '20'],
    ].map(([name, qty]) => {
      const p = byName(name ?? '');
      return { id: id(), productId: p.id, quantity: `${qty}.000`, costPrice: p.costPrice };
    }),
    createdBy: admin.id,
    confirmedBy: null,
    confirmedAt: null,
    createdAt: draftAt,
    updatedAt: draftAt,
  });

  // Bekor qilingan kirim (tarix uchun)
  const cancelledAt = atTashkent(addDays(today, -12), 15);
  state.counters.incoming += 1;
  state.incoming.push({
    id: id(),
    number: state.counters.incoming,
    date: addDays(today, -12),
    warehouseId: state.warehouses[1]?.id ?? '',
    notes: 'Yetkazib beruvchi yuborishni kechiktirdi',
    status: 'CANCELLED',
    items: [
      {
        id: id(),
        productId: byName('Zaryadlovchi 65W GaN').id,
        quantity: '15.000',
        costPrice: money(190_000),
      },
    ],
    createdBy: admin.id,
    confirmedBy: null,
    confirmedAt: null,
    createdAt: cancelledAt,
    updatedAt: cancelledAt,
  });

  // Bitta nofaol mahsulot (tarixi saqlangan)
  const inactive = byName('Telefon Tecno Spark 20');
  inactive.status = 'INACTIVE';

  // ── Xarajatlar ───────────────────────────────────────────────────────────
  const cat = (name: string) => state.expenseCategories.find((c) => c.name === name)!.id;
  const addExpense = (date: string, category: string, amount: number, note: string) => {
    const at = atTashkent(date, r.int(10, 18), r.int(0, 59));
    const row: ExpenseRow = {
      id: id(),
      date,
      amount: money(Math.round(amount / 1000) * 1000),
      categoryId: cat(category),
      note,
      createdBy: admin.id,
      createdAt: at,
      updatedAt: at,
      deletedAt: null,
    };
    state.expenses.push(row);
  };
  for (let d = 0; d <= HISTORY_DAYS; d++) {
    const date = addDays(startDay, d);
    const day = Number(date.slice(8, 10));
    const month = date.slice(0, 7);
    if (day === 1) {
      addExpense(date, 'Ijara', 12_000_000, `Asosiy ombor ijarasi, ${month}`);
      addExpense(date, 'Ijara', 7_000_000, `Yunusobod filiali ijarasi, ${month}`);
      addExpense(date, 'Ijara', 5_000_000, `Samarqand filiali ijarasi, ${month}`);
    }
    if (day === 5) addExpense(date, 'Ish haqi', 24_500_000, `Xodimlar ish haqi, ${month}`);
    if (day === 10)
      addExpense(date, 'Kommunal to‘lovlar', r.int(1_400_000, 2_600_000), 'Elektr, gaz, suv');
    if (day === 20)
      addExpense(date, 'Soliqlar', r.int(4_000_000, 6_500_000), 'Aylanmadan olinadigan soliq');
    if (d % 7 === 2)
      addExpense(date, 'Transport va yetkazib berish', r.int(300_000, 900_000), 'Tovar tashish');
    if (d % 14 === 6)
      addExpense(
        date,
        'Reklama',
        r.int(1_000_000, 3_000_000),
        r.pick(['Instagram reklama', 'Telegram kanal reklama', 'Banner va bukletlar']),
      );
    if (d % 7 === 4)
      addExpense(
        date,
        'Xo‘jalik xarajatlari',
        r.int(100_000, 450_000),
        r.pick(['Tozalash vositalari', 'Paketlar va qoplar', 'Ofis jihozlari']),
      );
    if (d % 19 === 9)
      addExpense(
        date,
        'Boshqa',
        r.int(200_000, 800_000),
        r.pick(['Bank xizmati', 'Kassa apparati xizmati', 'Internet']),
      );
  }

  for (const u of state.users) {
    if (u.status === 'ACTIVE' && u.lastLoginAt === null)
      u.lastLoginAt = new Date(nowMs - r.int(1, 48) * 3_600_000).toISOString();
  }
  admin.lastLoginAt = new Date(nowMs - 10 * 60_000).toISOString();

  return state;
}
