import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { t } from '@/i18n/uz';
import { BarcodeScannerDialog } from './BarcodeScannerDialog';

describe('BarcodeScannerDialog', () => {
  it('kamera mavjud bo‘lmagan muhitda (http) tushuntirish ko‘rsatadi', async () => {
    render(<BarcodeScannerDialog open onOpenChange={vi.fn()} onDetected={vi.fn()} />);
    expect(await screen.findByRole('alert')).toHaveTextContent(t.scanner.errors.unsupported);
  });

  it('yopiq oynada kamera ishga tushmaydi', () => {
    render(<BarcodeScannerDialog open={false} onOpenChange={vi.fn()} onDetected={vi.fn()} />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
