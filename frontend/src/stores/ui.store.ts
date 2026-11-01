import { create } from 'zustand';

/**
 * Faqat client-side UI holati. Server ma'lumotlari (ro'yxatlar, qoldiqlar) bu yerda SAQLANMAYDI —
 * ular TanStack Query keshida bo'ladi.
 */
export type Theme = 'light' | 'dark';

const THEME_KEY = 'divine.theme';
const SIDEBAR_KEY = 'divine.sidebar-collapsed';

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_KEY) === '1';
  } catch {
    return false;
  }
}

/** Standart — qora: birinchi marta kirgan odam qora fonni ko'radi; tanlov Sozlamalarda saqlanadi. */
function readTheme(): Theme {
  try {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved === 'light' || saved === 'dark') return saved;
  } catch {
    // Brauzer xotirasi yopiq bo'lishi mumkin — standart mavzu.
  }
  return 'dark';
}

export function applyTheme(theme: Theme): void {
  document.documentElement.classList.toggle('dark', theme === 'dark');
}

function persistTheme(theme: Theme): void {
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    // e'tiborsiz — mavzu faqat shu sessiya uchun
  }
}

interface UiState {
  mobileSidebarOpen: boolean;
  openMobileSidebar: () => void;
  closeMobileSidebar: () => void;
  theme: Theme;
  setTheme: (theme: Theme) => void;
  /** Desktop'da sidebar faqat ikonkalar bilan (yig'ilgan) ko'rinishi. */
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;
}

export const useUiStore = create<UiState>()((set, get) => ({
  mobileSidebarOpen: false,
  openMobileSidebar: () => set({ mobileSidebarOpen: true }),
  closeMobileSidebar: () => set({ mobileSidebarOpen: false }),
  theme: typeof window === 'undefined' ? 'dark' : readTheme(),
  setTheme: (theme) => {
    applyTheme(theme);
    persistTheme(theme);
    set({ theme });
  },
  sidebarCollapsed: typeof window === 'undefined' ? false : readCollapsed(),
  toggleSidebar: () => {
    const next = !get().sidebarCollapsed;
    try {
      localStorage.setItem(SIDEBAR_KEY, next ? '1' : '0');
    } catch {
      // e'tiborsiz
    }
    set({ sidebarCollapsed: next });
  },
}));

// Boshqa tabda mavzu o'zgarsa — shu tab ham darhol moslashadi (Sozlamalar banneri ham sinxron qoladi).
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key !== THEME_KEY) return;
    const theme: Theme = event.newValue === 'light' ? 'light' : 'dark';
    applyTheme(theme);
    useUiStore.setState({ theme });
  });
}
