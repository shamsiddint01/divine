import { create } from 'zustand';

/**
 * Faqat client-side UI holati. Server ma'lumotlari (ro'yxatlar, qoldiqlar) bu yerda SAQLANMAYDI —
 * ular TanStack Query keshida bo'ladi.
 */
const SIDEBAR_KEY = 'divine.sidebar-collapsed';

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_KEY) === '1';
  } catch {
    return false;
  }
}

interface UiState {
  mobileSidebarOpen: boolean;
  openMobileSidebar: () => void;
  closeMobileSidebar: () => void;
  /** Desktop'da sidebar faqat ikonkalar bilan (yig'ilgan) ko'rinishi. */
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;
}

export const useUiStore = create<UiState>()((set, get) => ({
  mobileSidebarOpen: false,
  openMobileSidebar: () => set({ mobileSidebarOpen: true }),
  closeMobileSidebar: () => set({ mobileSidebarOpen: false }),
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
