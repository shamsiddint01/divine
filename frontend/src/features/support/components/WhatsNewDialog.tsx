import { useState } from 'react';
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

const seen = () => {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return CHANGELOG[0]?.id ?? null;
  }
};

/** "Nima yangi": yangi imkoniyatlar haqida bir marta (har yangilanishda) ko'rsatiladi. */
export function WhatsNewDialog() {
  const latest = CHANGELOG[0];
  const [open, setOpen] = useState(() => Boolean(latest) && seen() !== latest?.id);
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
          <DialogTitle>Nima yangi: {latest.title}</DialogTitle>
          <DialogDescription>{latest.date}</DialogDescription>
        </DialogHeader>
        <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
          {latest.items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
        <DialogFooter>
          <Button onClick={close}>Tushunarli</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
