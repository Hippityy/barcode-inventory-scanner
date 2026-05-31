import { defineConfig } from 'vite';
import path from 'path';

export default defineConfig({
  base: '/barcode-inventory-scanner/',
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
