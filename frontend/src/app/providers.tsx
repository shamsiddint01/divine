import { QueryClientProvider } from '@tanstack/react-query';
import { type ReactNode, useEffect, useState } from 'react';
import { Toaster } from 'sonner';
import { isMockMode, MOCK_DB_CHANGED_EVENT } from '@/shared/lib/api-mode';
import { TooltipProvider } from '@/shared/ui/tooltip';
import { useUiStore } from '@/stores/ui.store';
import { createQueryClient } from './query-client';

export function AppProviders({ children }: { children: ReactNode }) {
  const [queryClient] = useState(createQueryClient);
  const theme = useUiStore((s) => s.theme);

  // Demo rejim: boshqa tabdagi o'zgarish (sotuv, kirim…) shu tabdagi ochiq sahifalarda darhol ko'rinsin.
  useEffect(() => {
    if (!isMockMode()) return;
    const refresh = () => void queryClient.invalidateQueries();
    window.addEventListener(MOCK_DB_CHANGED_EVENT, refresh);
    return () => window.removeEventListener(MOCK_DB_CHANGED_EVENT, refresh);
  }, [queryClient]);

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        {children}
        <Toaster position="top-right" richColors closeButton theme={theme} />
      </TooltipProvider>
    </QueryClientProvider>
  );
}
