import { configureZodUzbek } from '@divine/shared';

// Frontend'da zod faqat shu modul orqali ishlatiladi (ESLint `no-restricted-imports`). Shunda
// o'zbekcha xabarlar (server bilan bir xil matn) zod ishlatiladigan har bir chunk'da sozlangan
// bo'ladi, zod esa boshlang'ich bundle'ga tushmaydi (Phase 14: faqat formali sahifalar yuklaydi).
configureZodUzbek();

export { zodResolver } from '@hookform/resolvers/zod';
export { z } from 'zod';
