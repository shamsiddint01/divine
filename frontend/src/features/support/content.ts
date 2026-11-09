import { LICENSE_CONTACT_PHONE } from '@divine/shared';
import type { NavItem } from '@/app/navigation';

/** Murojaat bo'limining matnlari (2026-11-09): savol-javob, sahifa yordami, yangiliklar. */

export interface FaqItem {
  /** Baho (`support_feedback.topic`) shu kalit bilan yoziladi. */
  id: string;
  question: string;
  answer: string;
}

export const FAQ: FaqItem[] = [
  {
    id: 'start',
    question: 'Ishni nimadan boshlayman?',
    answer:
      'Avval Ombor bo‘limida ombor yarating, keyin Mahsulot guruhlari va Mahsulotlar qo‘shing. Mahsulot qo‘shganda boshlang‘ich qoldiqni ham kiriting. Shundan keyin Sotuvlar bo‘limida sotuv qilasiz.',
  },
  {
    id: 'product-add',
    question: 'Mahsulot qanday qo‘shiladi?',
    answer:
      'Mahsulotlar → "Mahsulot qo‘shish". Nom, guruh, kelgan narx va kamida bitta narx (dona yoki optom) majburiy. Shtrix-kod ixtiyoriy: maydonga bosib, qutidagi kodni skanerlasangiz o‘zi yoziladi.',
  },
  {
    id: 'stock',
    question: 'Qoldiq qanday qo‘shiladi?',
    answer:
      'Mahsulot tafsilotini oching va "Qoldiq qo‘shish"ni bosing: ombor, miqdor va kelgan narxni kiriting. Yangi mahsulotda qoldiqni qo‘shish oynasining o‘zida ham kiritsa bo‘ladi.',
  },
  {
    id: 'sale',
    question: 'Sotuv qanday qilinadi?',
    answer:
      'Sotuvlar → Yangi sotuv. Tovarni skanerlang, nomidan qidiring yoki "Tez tanlash"dan bosing. Mijoz to‘liq to‘lasa "Yopish" (F9), puli yetmasa "Nasiya" (F4).',
  },
  {
    id: 'credit',
    question: 'Nasiya qanday yoziladi va to‘lanadi?',
    answer:
      'Kassada "Nasiya"ni bosib, mijoz qancha to‘laganini kiriting: qolgani nasiyaga yoziladi. Nasiya bo‘limida mijozni ochib "To‘lovni saqlash" bilan qarz to‘lovi yoziladi.',
  },
  {
    id: 'barcode',
    question: 'Shtrix-kod skaneri ishlamayapti',
    answer:
      'Skaner kodni yozib Enter bosishi kerak. Kursor Shtrix-kod maydonida turganini tekshiring (F2), klaviatura tili lotincha bo‘lsin. Mahsulotdagi shtrix-kod skanerlangan kod bilan bir xil bo‘lishi kerak.',
  },
  {
    id: 'short-code',
    question: 'Shtrix-kodsiz tovarni qanday tez sotaman?',
    answer:
      'Mahsulotning Shtrix-kod maydoniga qisqa raqam yozing (masalan, 105). Kassada shu raqamni terib Enter bossangiz, tovar savatga tushadi. Ko‘p sotiladiganlar "Tez tanlash"da o‘zi chiqadi.',
  },
  {
    id: 'wholesale',
    question: 'Optom narxda qanday sotiladi?',
    answer:
      'Kassada "Dona / Optom" tugmasidan Optomni tanlang: savatdagi narxlar optom narxga o‘tadi. Optom narxi yo‘q tovar optomda sotilmaydi.',
  },
  {
    id: 'password',
    question: 'Parolni unutdim',
    answer:
      'Sotuvchi parolini admin tiklaydi: Userlar → foydalanuvchi → "Parolni tiklash". Admin parolini unutgan bo‘lsa, bizga murojaat qiling.',
  },
  {
    id: 'seller',
    question: 'Sotuvchini qanday qo‘shaman?',
    answer:
      'Userlar → "User qo‘shish": login va rolni tanlang, omborni biriktiring. Parol avtomatik yaratiladi va bir marta ko‘rsatiladi — sotuvchiga ayting.',
  },
  {
    id: 'slow',
    question: 'Sayt sekin ochilyapti',
    answer:
      'Uzoq ishlatilmagan sayt birinchi ochilishda uyg‘onadi — bir daqiqagacha kuting. Keyin odatdagidek tez ishlaydi. Har doim sekin bo‘lsa, murojaat yuboring.',
  },
  {
    id: 'blocked',
    question: 'Kirishda "to‘lov muddatingiz tugadi" chiqyapti',
    answer: `Dastur uchun to‘lov muddati o‘tgan. Ma’lumotlaringiz saqlanadi; to‘lovdan keyin sayt darhol ochiladi. Bog‘lanish: ${LICENSE_CONTACT_PHONE}.`,
  },
];

/** "?" belgisi: har bo'lim uchun qisqa yo'riq. */
export const PAGE_HELP: Partial<Record<NavItem['key'], string>> = {
  dashboard:
    'Bugungi savdo, ombor holati va kam qolgan mahsulotlar. Raqam ustiga bosib batafsil ko‘ring.',
  sales:
    'Yangi sotuv: tovarni skanerlang yoki tanlang, keyin "Yopish" (F9) yoki "Nasiya" (F4). "Sotuvlar tarixi"da cheklarni qayta ochasiz.',
  customers:
    'Mijozlar ro‘yxati va har birining xarid tarixi. Sotuvda ism yozilsa, mijoz o‘zi qo‘shiladi.',
  products:
    'Mahsulot qo‘shish, narx va shtrix-kod. Mahsulotni bosib tafsilotini oching: qoldiq qo‘shish va tarix shu yerda.',
  productGroups:
    'Mahsulotlarni guruhlash (masalan, Oziq-ovqat). Kassada guruh bo‘yicha saralanadi.',
  warehouses: 'Omborlar va ulardagi qoldiq. Sotuvchiga faqat biriktirilgan ombor ko‘rinadi.',
  credits: 'Kim, qachon, qancha nasiya olgani va to‘lov jadvali. Mijozni ochib to‘lov yozing.',
  expenses: 'Xarajatlar va ularning kategoriyalari. Sotuvchi faqat o‘z xarajatlarini ko‘radi.',
  reports: 'Sana oralig‘i bo‘yicha sotuv, foyda va ombor hisobotlari.',
  users: 'Sotuvchilar: qo‘shish, bloklash, parolni tiklash va omborga biriktirish.',
  billing: 'Dastur uchun to‘lov: keyingi to‘lov sanasi, balans va to‘lovlar tarixi.',
  settings: 'Korxona nomi va kam qoldiq chegarasi. Audit jurnalida kim nima qilgani ko‘rinadi.',
  support: 'Savol-javoblar, muammo haqida xabar berish va murojaatlaringizga javoblar.',
};

export const SHORTCUTS: { keys: string; action: string }[] = [
  { keys: 'F2', action: 'Shtrix-kod maydoni (kassa)' },
  { keys: 'F3', action: 'Mahsulot qidiruvi (kassa)' },
  { keys: 'F4', action: 'Nasiya oynasi (kassa)' },
  { keys: 'F9', action: 'Sotuvni yopish (kassa)' },
  { keys: '+ / −', action: 'Oxirgi tovar soni (kassa, shtrix-kod maydoni bo‘sh bo‘lsa)' },
  { keys: 'Alt+1…9', action: 'Tez tanlash tugmasi (kassa)' },
  { keys: 'Enter', action: 'Chekdan keyingi sotuvga o‘tish' },
  { keys: '?', action: 'Shu ro‘yxatni ochish' },
];

/** "Nima yangi": yangisi tepada; `id` o'zgarsa, foydalanuvchiga bir marta ko'rsatiladi. */
export const CHANGELOG: { id: string; date: string; title: string; items: string[] }[] = [
  {
    id: '2026-11-09',
    date: '09.11.2026',
    title: 'Murojaat bo‘limi',
    items: [
      'Savol-javoblar va qidiruv',
      'Muammo haqida xabar berish va javoblarni shu yerda ko‘rish',
      'Har bo‘limda "?" yordami va klaviatura ro‘yxati (? tugmasi)',
    ],
  },
  {
    id: '2026-11-08',
    date: '08.11.2026',
    title: 'Tez kassa',
    items: [
      'Eng ko‘p sotiladiganlar uchun "Tez tanlash" (Alt+1…9)',
      'F2, F3, F4, F9 va + / − tugmalari',
    ],
  },
  {
    id: '2026-11-07',
    date: '07.11.2026',
    title: 'To‘lov bo‘limi',
    items: ['Admin uchun dastur to‘lovi: muddat, balans va tarix'],
  },
];
