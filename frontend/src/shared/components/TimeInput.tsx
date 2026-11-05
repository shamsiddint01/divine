import type { ComponentProps } from 'react';
import { Input } from '@/shared/ui/input';

/** 24 soatlik vaqt: `00:00` – `23:59`. */
export const TIME_24H = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Raqamlardan `HH:mm`: `1430` → `14:30`. */
const formatTime = (value: string) => {
  const digits = value.replace(/\D/g, '').slice(0, 4);
  return digits.length > 2 ? `${digits.slice(0, 2)}:${digits.slice(2)}` : digits;
};

type TimeInputProps = Omit<ComponentProps<typeof Input>, 'value' | 'onChange' | 'type'> & {
  value: string;
  onChange: (value: string) => void;
};

/**
 * Vaqt maydoni, doim 24 soatlik. Brauzerning `type="time"` maydoni tizim tiliga qarab AM/PM ko'rsatadi,
 * shuning uchun oddiy matn maydoni va `HH:mm` niqobi ishlatiladi.
 */
export function TimeInput({ value, onChange, ...props }: TimeInputProps) {
  return (
    <Input
      {...props}
      type="text"
      inputMode="numeric"
      autoComplete="off"
      maxLength={5}
      value={value}
      onChange={(event) => onChange(formatTime(event.target.value))}
    />
  );
}
