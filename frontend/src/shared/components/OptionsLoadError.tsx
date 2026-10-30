import { t } from '@/i18n/uz';

/**
 * Forma tanlov ro'yxati yuklanmadi (REQ-154): bo'sh ro'yxat "ma'lumot yo'q" deb tushunilmasin.
 * `FormField`ning `hint` joyida ishlatiladi.
 */
export function OptionsLoadError({ onRetry }: { onRetry: () => void }) {
  return (
    <span role="alert" className="inline-flex flex-wrap items-center gap-x-2 text-destructive">
      {t.common.optionsLoadFailed}
      <button
        type="button"
        className="font-medium underline underline-offset-2 hover:no-underline"
        onClick={onRetry}
      >
        {t.common.retry}
      </button>
    </span>
  );
}
