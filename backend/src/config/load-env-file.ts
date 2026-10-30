// Mahalliy ishlab chiqishda repo ildizidagi `.env` faylni yuklaydi.
// main.ts'da BIRINCHI import bo'lishi shart: ESM importlari tartib bilan baholanadi,
// shuning uchun keyingi modullar env'ni allaqachon to'ldirilgan holda ko'radi.
// Production'da env konteyner/orkestrator tomonidan beriladi va fayl o'qilmaydi.
// Allaqachon o'rnatilgan env o'zgaruvchilari fayldagi qiymat bilan almashtirilmaydi.
import { existsSync } from 'node:fs';
import { loadSecretFiles } from './secret-files.js';

if (process.env.NODE_ENV !== 'production') {
  // backend/src/config/ yoki backend/dist/config/ → repo ildizi
  const rootEnvFile = new URL('../../../.env', import.meta.url);
  if (existsSync(rootEnvFile)) process.loadEnvFile(rootEnvFile);
}

// Production: secretlar Docker secrets fayllaridan (`<KEY>_FILE`, Phase 17). Har qanday muhitda ishlaydi.
loadSecretFiles();
