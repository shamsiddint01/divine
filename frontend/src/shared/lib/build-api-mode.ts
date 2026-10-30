/**
 * Build vaqtidagi himoya (Phase 16, SECURITY §19): `VITE_API_MODE` standart qiymati `mock` (brauzer ichidagi
 * namunaviy API) — u faqat `.env` orqali dev uchun beriladi. Docker image'ga `.env` kirmaydi; qiymat
 * berilmasa production SPA jimgina mock bilan yig'ilar edi (sotuvlar backend'ga emas, localStorage'ga).
 * Shuning uchun `vite build` rejimni aniq talab qiladi. Import'siz — `vite.config.ts` ham ishlatadi.
 */
export function assertBuildApiMode(value: string | undefined): 'http' | 'mock' {
  if (value === 'http' || value === 'mock') return value;
  throw new Error(
    `VITE_API_MODE build uchun aniq berilishi kerak: "http" (haqiqiy backend) yoki "mock" (demo). Hozir: ${
      value === undefined ? 'berilmagan' : JSON.stringify(value)
    }`,
  );
}
