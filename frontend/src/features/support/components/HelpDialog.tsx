import { CircleHelp } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router';
import { findNavItem } from '@/app/navigation-context';
import { Button } from '@/shared/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/shared/ui/dialog';
import { PAGE_HELP, SHORTCUTS } from '../content';

const isTyping = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));

/** "?" tugmasi (yuqori panel) va `?` klaviatura: shu bo'lim yo'rig'i va tugmalar ro'yxati. */
export function HelpButton() {
  const [open, setOpen] = useState(false);
  const { pathname } = useLocation();
  const section = findNavItem(pathname);
  const help = section ? PAGE_HELP[section.key] : undefined;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== '?' || isTyping(event.target)) return;
      if (document.querySelector('[role="dialog"]')) return;
      event.preventDefault();
      setOpen(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <>
      <Button variant="ghost" size="icon" aria-label="Yordam" title="Yordam (?)" onClick={() => setOpen(true)}>
        <CircleHelp />
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{section ? section.label : 'Yordam'}</DialogTitle>
            <DialogDescription>{help ?? 'Divine bo‘yicha qisqa yordam.'}</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <p className="text-sm font-medium">Klaviatura</p>
            <ul className="divide-y rounded-lg border text-sm">
              {SHORTCUTS.map((item) => (
                <li key={item.keys} className="flex items-center justify-between gap-3 px-3 py-2">
                  <span className="text-muted-foreground">{item.action}</span>
                  <kbd className="shrink-0 rounded border bg-muted px-1.5 font-mono text-xs">
                    {item.keys}
                  </kbd>
                </li>
              ))}
            </ul>
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="outline" asChild onClick={() => setOpen(false)}>
              <Link to="/support">Savol-javoblar</Link>
            </Button>
            <Button asChild onClick={() => setOpen(false)}>
              <Link to={`/support?tab=new&page=${encodeURIComponent(pathname)}`}>
                Muammo haqida xabar berish
              </Link>
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
