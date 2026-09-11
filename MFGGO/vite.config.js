import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  base: './',
  server: {
    proxy: {
      '/api': process.env.VITE_API_TARGET || 'http://127.0.0.1:4310'
    }
  },
  build: {
    rollupOptions: {
      input: {
        cloud: resolve(import.meta.dirname, 'index.html'),
        enterprise: resolve(import.meta.dirname, 'enterprise.html'),
        admin: resolve(import.meta.dirname, 'admin.html'),
        platform: resolve(import.meta.dirname, 'platform.html'),
        bomSheet: resolve(import.meta.dirname, 'bom-sheet.html'),
        onlyoffice: resolve(import.meta.dirname, 'onlyoffice.html'),
        workspace: resolve(import.meta.dirname, 'workspace.html')
      }
    }
  }
});
