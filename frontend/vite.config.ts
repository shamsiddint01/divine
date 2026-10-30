import { fileURLToPath, URL } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';
import { assertBuildApiMode } from './src/shared/lib/build-api-mode';

// Env repo ildizidagi .env'dan o'qiladi; brauzerga faqat VITE_ prefiksli qiymatlar chiqadi.
const envDir = fileURLToPath(new URL('../', import.meta.url));

export default defineConfig(({ command, mode }) => {
  // Production build har doim NODE_ENV=production bilan: aks holda (shell yoki .env'da
  // NODE_ENV=development bo'lsa) bundle ichiga React'ning development versiyasi tushadi.
  if (command === 'build') process.env.NODE_ENV = 'production';
  const env = loadEnv(mode, envDir, ['VITE_', 'WEB_']);
  // Rejim aniq bo'lmasa build to'xtaydi: Docker image'da `.env` yo'q (Phase 16, SECURITY §19).
  if (command === 'build') assertBuildApiMode(env.VITE_API_MODE);
  return {
    envDir,
    plugins: [react(), tailwindcss()],
    // Bir vaqtda ishlayotgan bir nechta dev nusxasi (har xil port) umumiy optimizeDeps keshini bir-biridan
    // o'chirib yubormasin: aks holda biri qayta optimallashtirganda ikkinchisida 504 "Outdated Optimize Dep".
    cacheDir: env.WEB_DEV_PORT ? `node_modules/.vite/port-${env.WEB_DEV_PORT}` : undefined,
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
        // Shared paket manba koddan olinadi: `cd frontend && pnpm dev` oldindan build talab qilmaydi.
        '@divine/shared': fileURLToPath(new URL('../shared/src/index.ts', import.meta.url)),
      },
    },
    optimizeDeps: {
      // Lazy sahifalardagi dependency'lar (recharts, react-hook-form, react-day-picker…) ham startup'da
      // topilsin: aks holda Vite ularni sahifa birinchi ochilganda qayta optimallashtiradi va eski `?v=`
      // havolalar 504 "Outdated Optimize Dep" beradi ("Failed to fetch dynamically imported module").
      entries: [
        'index.html',
        'src/**/*.{ts,tsx}',
        '!src/**/__tests__/**',
        '!src/**/*.test.{ts,tsx}',
      ],
    },
    server: {
      // Bir mashinada bir nechta nusxa ishlashi uchun port env orqali o'zgartiriladi.
      port: Number(env.WEB_DEV_PORT ?? 5173),
      strictPort: true,
      // Dev'da API bilan bir origin — CORS va cookie muammolarisiz.
      proxy: {
        '/api': {
          target: env.VITE_DEV_API_PROXY_TARGET ?? 'http://localhost:3000',
          changeOrigin: false,
        },
      },
    },
    build: {
      sourcemap: true,
      target: 'es2022',
      // Sahifalar lazy yuklanadi; asosiy vendor chunk (react, router, query) ~300 KB atrofida.
      chunkSizeWarningLimit: 600,
    },
  };
});
