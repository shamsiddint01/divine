import { SlidersHorizontal } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { t } from '@/i18n/uz';
import { PHONE_QUERY, useMediaQuery } from '@/shared/hooks/use-media-query';
import { cn } from '@/shared/lib/utils';
import { Button } from '@/shared/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/shared/ui/sheet';

interface FilterBarProps {
  /** Qidiruv maydoni — telefonda ham doim ko'rinib turadi. */
  search?: ReactNode;
  /** Filtrlar (select, sana oralig'i, "tozalash" tugmasi). */
  children: ReactNode;
  /** Qidiruvdan tashqari biror filtr tanlanganmi — telefondagi tugmada belgi. */
  active: boolean;
  /** Qaysi kenglikdan filtrlar bir qatorga tiziladi (sahifalardagi oldingi tartib saqlanadi). */
  inlineFrom?: 'sm' | 'lg';
}

/**
 * Ro'yxat filtrlari paneli. Telefonda filtrlar ustma-ust turib ma'lumotni ekrandan siqib chiqarmasin:
 * qidiruv ko'rinadi, qolganlari "Filtrlar" tugmasi orqali pastdan ochiladigan oynada.
 * Filtrlar darhol qo'llanadi — oyna faqat joylashuv.
 */
export function FilterBar({ search, children, active, inlineFrom = 'lg' }: FilterBarProps) {
  const isPhone = useMediaQuery(PHONE_QUERY);
  const [open, setOpen] = useState(false);

  if (!isPhone) {
    return (
      <div
        className={cn(
          'flex flex-col gap-2',
          inlineFrom === 'lg'
            ? 'lg:flex-row lg:flex-wrap lg:items-center'
            : 'sm:flex-row sm:flex-wrap',
        )}
      >
        {search}
        {children}
      </div>
    );
  }

  return (
    <div className="flex gap-2">
      <div className="min-w-0 flex-1">{search}</div>
      <Button
        variant="outline"
        className={cn('relative shrink-0', !search && 'flex-1')}
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-label={active ? t.common.filtersActive : t.common.filters}
      >
        <SlidersHorizontal />
        {t.common.filters}
        {active ? (
          <span className="absolute -top-1 -right-1 size-2.5 rounded-full bg-primary ring-2 ring-background" />
        ) : null}
      </Button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="bottom" className="max-h-[85dvh] gap-0 rounded-t-2xl">
          <SheetHeader className="px-5 py-4">
            <SheetTitle>{t.common.filters}</SheetTitle>
            <SheetDescription className="sr-only">{t.common.filters}</SheetDescription>
          </SheetHeader>
          <div className="flex flex-col gap-3 overflow-y-auto p-5 [&_[data-slot=select-trigger]]:h-11">
            {children}
          </div>
          <SheetFooter className="pb-[calc(env(safe-area-inset-bottom)+1rem)]">
            <Button size="lg" onClick={() => setOpen(false)}>
              {t.common.showResults}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </div>
  );
}
