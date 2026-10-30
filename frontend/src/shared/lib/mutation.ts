import { toast } from 'sonner';
import { t } from '@/i18n/uz';
import { ApiError } from './api-client';

/** Mutatsiya xatosini foydalanuvchiga o'zbekcha toast sifatida ko'rsatish. */
export function toastError(error: unknown): void {
  toast.error(error instanceof ApiError ? error.message : t.errors.unexpected);
}

/** Server `details[]` xatolarini forma maydonlariga bog'lash (react-hook-form `setError`). */
export function applyFieldErrors(
  error: unknown,
  setError: (field: never, e: { message: string }) => void,
): boolean {
  if (!(error instanceof ApiError) || error.details.length === 0) return false;
  for (const d of error.details) setError(d.field as never, { message: d.message });
  return true;
}

/** Server xatosidagi bitta maydon xabari (`details[].field`) — forma kutubxonasisiz inputlar uchun. */
export function fieldErrorOf(error: unknown, field: string): string | null {
  if (!(error instanceof ApiError)) return null;
  return error.details.find((d) => d.field === field)?.message ?? null;
}
