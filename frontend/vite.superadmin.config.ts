import { defineConfig, mergeConfig } from 'vite';
import base from './vite.config';

// Superadmin paneli: mijoz saytidan alohida build va alohida manzil (scripts/render/build-superadmin.sh).
export default defineConfig((env) =>
  mergeConfig(base(env), {
    build: {
      outDir: 'dist-superadmin',
      emptyOutDir: true,
      rollupOptions: { input: 'superadmin.html' },
    },
  }),
);
