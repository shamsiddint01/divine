import { CalendarDays, X } from 'lucide-react';
import { useState } from 'react';
import type { DateRange } from 'react-day-picker';
import { t } from '@/i18n/uz';
import { formatDate, todayInTashkent } from '@/shared/lib/format';
import { cn } from '@/shared/lib/utils';
import { Button } from '@/shared/ui/button';
import { Calendar } from '@/shared/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/shared/ui/popover';

export interface DateRangeValue {
  from: string;
  to: string;
}

/** `YYYY-MM-DD` ↔ Date (kalendar kuni sifatida, vaqt zonasisiz). */
const toDate = (s: string) => (s ? new Date(`${s}T12:00:00`) : undefined);
const toIso = (d: Date | undefined) =>
  d
    ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    : '';

function shift(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

interface DateRangeFilterProps {
  value: DateRangeValue;
  onChange: (value: DateRangeValue) => void;
  className?: string;
}

/** Sana oralig'i filtri: tayyor variantlar + o'zbekcha kalendar. Ikkala chegara ham kiradi. */
export function DateRangeFilter({ value, onChange, className }: DateRangeFilterProps) {
  const [open, setOpen] = useState(false);
  const today = todayInTashkent();
  const presets: [string, DateRangeValue][] = [
    [t.common.presetToday, { from: today, to: today }],
    [t.common.preset7, { from: shift(today, -6), to: today }],
    [t.common.preset30, { from: shift(today, -29), to: today }],
    [t.common.presetMonth, { from: `${today.slice(0, 7)}-01`, to: today }],
  ];
  const label = value.from
    ? value.to && value.to !== value.from
      ? `${formatDate(value.from)} – ${formatDate(value.to)}`
      : formatDate(value.from)
    : t.common.presetAll;
  const selected: DateRange | undefined = value.from
    ? { from: toDate(value.from), to: toDate(value.to || value.from) }
    : undefined;

  return (
    <div className={cn('flex items-center', className)}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            className={cn(
              // Tor ekranda qolgan joyni egallaydi ("Tiklash" tugmasiga ham joy qoladi); `min-w-0` —
              // uzun oraliq matni (`truncate`) qisqaradi, sahifa kengaymaydi.
              'min-w-0 flex-1 justify-start font-normal sm:flex-none',
              !value.from && 'text-muted-foreground',
            )}
            aria-label={t.common.dateRange}
          >
            <CalendarDays />
            <span className="truncate">{label}</span>
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <div className="flex flex-col sm:flex-row">
            <div className="flex flex-row flex-wrap gap-1 border-b p-2 sm:w-40 sm:flex-col sm:border-r sm:border-b-0">
              {presets.map(([text, range]) => (
                <Button
                  key={text}
                  variant={
                    value.from === range.from && value.to === range.to ? 'secondary' : 'ghost'
                  }
                  size="sm"
                  className="justify-start"
                  onClick={() => {
                    onChange(range);
                    setOpen(false);
                  }}
                >
                  {text}
                </Button>
              ))}
              <Button
                variant={!value.from ? 'secondary' : 'ghost'}
                size="sm"
                className="justify-start"
                onClick={() => {
                  onChange({ from: '', to: '' });
                  setOpen(false);
                }}
              >
                {t.common.presetAll}
              </Button>
            </div>
            <Calendar
              mode="range"
              numberOfMonths={1}
              defaultMonth={toDate(value.from || today)}
              selected={selected}
              onSelect={(range) =>
                onChange({ from: toIso(range?.from), to: toIso(range?.to ?? range?.from) })
              }
              disabled={{ after: toDate(today) as Date }}
            />
          </div>
        </PopoverContent>
      </Popover>
      {value.from ? (
        <Button
          variant="ghost"
          size="icon"
          className="ml-1 size-8"
          onClick={() => onChange({ from: '', to: '' })}
          aria-label={t.common.reset}
        >
          <X />
        </Button>
      ) : null}
    </div>
  );
}
