import { defineConfig } from 'astro/config';

export default defineConfig({
  server: {
    host: true,
    port: 4321,
    strictPort: true,
    allowedHosts: ['tasks'],
  },
});
