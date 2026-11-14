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

const hasCamera = () => typeof navigator.mediaDevices?.getUserMedia === 'function';

function errorOf(error: unknown): ScannerError {
  const name = error instanceof DOMException ? error.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'denied';
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'noCamera';
  return 'failed';
}

type NativeDetector = { detect: (source: HTMLVideoElement) => Promise<{ rawValue: string }[]> };
type NativeDetectorCtor = new () => NativeDetector;

const nativeDetector = () =>
  (window as unknown as { BarcodeDetector?: NativeDetectorCtor }).BarcodeDetector;

const onFound = (code: string, report: (code: string) => void) => {
  navigator.vibrate?.(60);
  report(code);
};

/**
 * Brauzerning ichki detektori (Android Chrome): telefon kamerasi ilovasi kabi tez va aniq, barcha kod turlari.
 * Qo'llab-quvvatlanmasa `null` qaytadi va zxing ishlatiladi.
 */
async function startNative(
  video: HTMLVideoElement,
  report: (code: string) => void,
): Promise<(() => void) | null> {
  const Detector = nativeDetector();
  if (!Detector) return null;
  const detector = new Detector();
  const stream = await navigator.mediaDevices.getUserMedia({
    video: {
      facingMode: { ideal: 'environment' },
      width: { ideal: 1920 },
      height: { ideal: 1080 },
    },
  });
  const track = stream.getVideoTracks()[0];
  // Uzluksiz fokus: yaqin masofadagi QR/shtrix-kod aniq chiqadi.
  await track
    ?.applyConstraints({ advanced: [{ focusMode: 'continuous' } as MediaTrackConstraintSet] })
    .catch(() => undefined);
  video.srcObject = stream;
  await video.play();
  let alive = true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const stop = () => {
    alive = false;
    clearTimeout(timer);
    stream.getTracks().forEach((item) => item.stop());
    video.srcObject = null;
  };
  const tick = async () => {
    if (!alive) return;
    try {
      const [found] = video.readyState >= 2 ? await detector.detect(video) : [];
      if (found?.rawValue && alive) {
        stop();
        onFound(found.rawValue, report);
        return;
      }
    } catch {
      // Bitta kadrni o'qib bo'lmadi — keyingisiga o'tamiz.
    }
    if (alive) timer = setTimeout(() => void tick(), 100);
  };
  void tick();
  return stop;
}

/** Zaxira: `BarcodeDetector` yo'q brauzerlar (iPhone Safari, Firefox) uchun zxing. */
async function startZxing(
  video: HTMLVideoElement,
  report: (code: string) => void,
): Promise<() => void> {
  const [{ BrowserMultiFormatReader }, { DecodeHintType }] = await Promise.all([
    import('@zxing/browser'),
    import('@zxing/library'),
  ]);
  // `POSSIBLE_FORMATS` berilmaydi: QR, Data Matrix, Code 39/93/128, EAN/UPC, ITF, PDF417 va boshqalar o'qiladi.
  const hints = new Map<number, unknown>([[DecodeHintType.TRY_HARDER, true]]);
  const reader = new BrowserMultiFormatReader(hints, { delayBetweenScanAttempts: 80 });
  const controls = await reader.decodeFromConstraints(
    {
      video: {
        facingMode: { ideal: 'environment' },
        width: { ideal: 1920 },
        height: { ideal: 1080 },
      },
    },
    video,
    (result, _error, active) => {
      if (!result) return;
      active.stop();
      onFound(result.getText(), report);
    },
  );
  return () => controls.stop();
}

/**
 * Kamera oqimi va o'qish: oyna ochilganda ishga tushadi, kod topilganda yoki yopilganda kamera to'xtaydi.
 * O'qish kutubxonasi faqat shu yerda yuklanadi (kassa sahifasi og'irlashmaydi).
 */
function ScannerView({ onDetected }: { onDetected: (code: string) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const latest = useRef(onDetected);
  // `http` manzilda brauzer `mediaDevices`ni umuman bermaydi.
  const [error, setError] = useState<ScannerError | null>(() =>
    hasCamera() ? null : 'unsupported',
  );
  const [ready, setReady] = useState(false);

  useEffect(() => {
    latest.current = onDetected;
  }, [onDetected]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !hasCamera()) return;
    let cancelled = false;
    let stop: (() => void) | undefined;
    void (async () => {
      try {
        const report = (code: string) => latest.current(code);
        const started =
          (await startNative(video, report).catch(() => null)) ?? (await startZxing(video, report));
        if (cancelled) started();
        else {
          stop = started;
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
