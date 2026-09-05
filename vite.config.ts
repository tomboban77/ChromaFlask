import { defineConfig } from 'vite';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  base: './',
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: { host: true, port: 5173 },
  build: {
    target: 'es2022',
    // No maps in the published bundle: they reproduce every source file
    // verbatim (including the support-code secret) and add ~2.7 MB to dist.
    // Flip to 'hidden' if an error tracker needs them uploaded out of band.
    sourcemap: false,
    rollupOptions: {
      output: {
        // Rolldown (Vite 8) requires the function form; the object form that
        // worked under Rollup throws "manualChunks is not a function".
        manualChunks(id: string) {
          if (id.includes('node_modules/pixi.js')) return 'pixi';
          if (id.includes('node_modules/gsap')) return 'gsap';
          return undefined;
        },
      },
    },
  },
});
