import { Loader2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { t } from '@/i18n/uz';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/shared/ui/dialog';

type ScannerError = keyof typeof t.scanner.errors;

function errorOf(error: unknown): ScannerError {
  const name = error instanceof DOMException ? error.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'denied';
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'noCamera';
  return 'failed';
}

/**
 * Kamera oqimi va o'qish: oyna ochilganda ishga tushadi, kod topilganda yoki yopilganda kamera to'xtaydi.
 * O'qish kutubxonasi faqat shu yerda yuklanadi (kassa sahifasi og'irlashmaydi).
 */
function ScannerView({ onDetected }: { onDetected: (code: string) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const latest = useRef(onDetected);
  const [error, setError] = useState<ScannerError | null>(() =>
    navigator.mediaDevices?.getUserMedia ? null : 'unsupported',
  );
  const [ready, setReady] = useState(false);

  useEffect(() => {
    latest.current = onDetected;
  }, [onDetected]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !navigator.mediaDevices?.getUserMedia) return;
    let cancelled = false;
    let stop: (() => void) | undefined;
    void (async () => {
      try {
        const [{ BrowserMultiFormatReader }, { BarcodeFormat, DecodeHintType }] = await Promise.all(
          [import('@zxing/browser'), import('@zxing/library')],
        );
        if (cancelled) return;
        const hints = new Map<number, unknown>([
          [
            DecodeHintType.POSSIBLE_FORMATS,
            [
              BarcodeFormat.EAN_13,
              BarcodeFormat.EAN_8,
              BarcodeFormat.UPC_A,
              BarcodeFormat.UPC_E,
              BarcodeFormat.CODE_128,
            ],
          ],
          [DecodeHintType.TRY_HARDER, true],
        ]);
        const reader = new BrowserMultiFormatReader(hints);
        const controls = await reader.decodeFromConstraints(
          { video: { facingMode: { ideal: 'environment' } } },
          video,
          (result, _error, active) => {
            if (!result) return;
            active.stop();
            navigator.vibrate?.(60);
            latest.current(result.getText());
          },
        );
        if (cancelled) controls.stop();
        else {
          stop = () => controls.stop();
          setReady(true);
        }
      } catch (cause) {
        if (!cancelled) setError(errorOf(cause));
      }
    })();
    return () => {
      cancelled = true;
      stop?.();
    };
  }, []);

  if (error) {
    return (
      <p role="alert" className="rounded-lg border bg-muted/40 p-4 text-sm">
        {t.scanner.errors[error]}
      </p>
    );
  }
  return (
    <div className="relative aspect-[4/3] overflow-hidden rounded-lg bg-black">
      <video
        ref={videoRef}
        className="size-full object-cover"
        muted
        playsInline
        aria-label={t.scanner.title}
      />
      {ready ? (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-x-6 top-1/2 h-0.5 -translate-y-1/2 bg-destructive/80"
        />
      ) : (
        <span className="absolute inset-0 flex items-center justify-center text-white">
          <Loader2 className="size-6 animate-spin" aria-hidden />
        </span>
      )}
    </div>
  );
}

/** Telefon yoki kompyuter kamerasi bilan shtrix-kod o'qish. Kamera faqat `https` yoki `localhost` da ochiladi. */
export function BarcodeScannerDialog({
  open,
  onOpenChange,
  onDetected,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDetected: (code: string) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t.scanner.title}</DialogTitle>
          <DialogDescription>{t.scanner.hint}</DialogDescription>
        </DialogHeader>
        {open ? (
          <ScannerView
            onDetected={(code) => {
              onOpenChange(false);
              onDetected(code);
            }}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
