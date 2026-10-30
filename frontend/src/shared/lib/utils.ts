import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Tailwind klasslarini shartli birlashtirish (shadcn/ui standarti). */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
