import { useState } from 'react';
import { t } from '@/i18n/uz';
import { Button } from '@/shared/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/ui/dialog';
import { CHANGELOG } from '../content';

const KEY = 'divine.whats-new-seen';

/**
 * Avval kirgan foydalanuvchiga yangilanishdan keyin bir marta. Birinchi kirishda ko'rsatilmaydi (yangi
 * mijozga "Boshlash uchun 3 qadam" bor): joriy versiya shunchaki eslab qolinadi.
 */
const shouldOpen = (latestId: string): boolean => {
  try {
    const seen = localStorage.getItem(KEY);
    if (seen === null) {
      localStorage.setItem(KEY, latestId);
      return false;
    }
    return seen !== latestId;
  } catch {
    return false;
  }
};

/** "Nima yangi": yangi imkoniyatlar haqida bir marta (har yangilanishda) ko'rsatiladi. */
export function WhatsNewDialog() {
  const latest = CHANGELOG[0];
  const [open, setOpen] = useState(() => (latest ? shouldOpen(latest.id) : false));
  if (!latest) return null;
  const close = () => {
    try {
      localStorage.setItem(KEY, latest.id);
    } catch {
      // Saqlash o'chiq: keyingi kirishda yana ko'rsatiladi.
    }
    setOpen(false);
  };
  return (
    <Dialog open={open} onOpenChange={(next) => !next && close()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {t.support.newsTitle}: {latest.title}
          </DialogTitle>
          <DialogDescription>{latest.date}</DialogDescription>
        </DialogHeader>
        <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
          {latest.items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
        <DialogFooter>
          <Button onClick={close}>{t.support.gotIt}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
