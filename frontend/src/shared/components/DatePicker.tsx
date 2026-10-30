import { CalendarDays } from 'lucide-react';
import { useState } from 'react';
import { t } from '@/i18n/uz';
import { formatDate, todayInTashkent } from '@/shared/lib/format';
import { cn } from '@/shared/lib/utils';
import { Button } from '@/shared/ui/button';
import { Calendar } from '@/shared/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/shared/ui/popover';

const toDate = (s: string) => (s ? new Date(`${s}T12:00:00`) : undefined);
const toIso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

interface DatePickerProps {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  invalid?: boolean;
  /** Kelajakdagi sanalarni taqiqlash (standart: ha). */
  disableFuture?: boolean;
}

/** Bitta sana tanlash (`YYYY-MM-DD`) — o'zbekcha kalendar bilan. */
export function DatePicker({
  id,
  value,
  onChange,
  disabled,
  invalid,
  disableFuture = true,
}: DatePickerProps) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          variant="outline"
          disabled={disabled}
          aria-invalid={invalid || undefined}
          className={cn(
            'w-full justify-start bg-card font-normal',
            !value && 'text-muted-foreground',
            invalid && 'border-destructive',
          )}
        >
          <CalendarDays />
          {value ? formatDate(value) : t.common.pickDate}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          selected={toDate(value)}
          defaultMonth={toDate(value)}
          onSelect={(d) => {
            if (d) onChange(toIso(d));
            setOpen(false);
          }}
          disabled={disableFuture ? { after: toDate(todayInTashkent()) as Date } : undefined}
        />
      </PopoverContent>
    </Popover>
  );
}
