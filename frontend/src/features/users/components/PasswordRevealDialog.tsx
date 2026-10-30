import { Copy, KeyRound, ShieldAlert } from 'lucide-react';
import { toast } from 'sonner';
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

/**
 * Server yaratgan 6 xonali parolni BIR MARTA ko'rsatish (REQ-026, BR-02).
 * Parol hech qayerda saqlanmaydi: oyna yopilgach, holatdan o'chiriladi.
 */
export function PasswordRevealDialog({
  login,
  password,
  onClose,
}: {
  login: string;
  password: string | null;
  onClose: () => void;
}) {
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(password ?? '');
      toast.success(t.common.copied);
    } catch {
      toast.error(t.errors.unexpected);
    }
  };
  return (
    <Dialog open={Boolean(password)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md" onInteractOutside={(e) => e.preventDefault()}>
        <DialogHeader className="items-center text-center">
          <span className="mb-1 flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
            <KeyRound className="size-6" />
          </span>
          <DialogTitle>{t.users.password.title}</DialogTitle>
          <DialogDescription>{t.users.password.description(login)}</DialogDescription>
        </DialogHeader>
        <div className="flex items-center justify-center gap-3">
          <p
            className="rounded-lg border bg-muted/50 px-5 py-3 font-mono text-3xl font-semibold tracking-[0.4em] tabular-nums"
            aria-live="polite"
          >
            {password}
          </p>
          <Button variant="outline" size="icon" onClick={copy} aria-label={t.common.copy}>
            <Copy />
          </Button>
        </div>
        <p className="flex items-start gap-2 rounded-md bg-warning/10 p-3 text-sm text-warning">
          <ShieldAlert className="mt-0.5 size-4 shrink-0" />
          {t.users.password.warning}
        </p>
        <DialogFooter>
          <Button className="w-full" onClick={onClose}>
            {t.users.password.done}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
