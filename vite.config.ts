import { defineConfig, type Plugin } from 'vite';
import { fileURLToPath, URL } from 'node:url';

/**
 * Content Security Policy for the published build. Delivered as a <meta> tag
 * because static hosts (GitHub Pages) cannot set headers. Any script that is
 * not part of the bundle - injected by an extension, a compromised dependency
 * or a future XSS - becomes a no-op.
 *
 *  - style-src 'unsafe-inline': GSAP and Pixi set inline styles; index.html
 *    has one inline style attribute.
 *  - img-src data:/blob: and worker-src blob:: Pixi's texture loader.
 *  - connect-src: PostHog capture endpoint only.
 *
 * Two flavours:
 *  - web (default): as above.
 *  - native (`vite build --mode native`, the Capacitor wrapper): Capacitor's
 *    Android bridge is injected as an *inline* <script> into the page head,
 *    which `script-src 'self'` would block, leaving no `window.Capacitor` and
 *    no plugins. That flavour allows inline scripts; every other directive
 *    stays. Ads and billing are native SDKs, not web requests, so nothing
 *    else changes.
 *
 * Build-only: the dev server needs inline HMR scripts and a websocket.
 */
function csp(native: boolean): string {
  return [
    "default-src 'self'",
    native ? "script-src 'self' 'unsafe-inline'" : "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self' https://us.i.posthog.com",
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "media-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'none'",
  ].join('; ');
}

function cspMeta(native: boolean): Plugin {
  return {
    name: 'chromaflask:csp-meta',
    apply: 'build',
    transformIndexHtml() {
      return [
        {
          tag: 'meta',
          attrs: { 'http-equiv': 'Content-Security-Policy', content: csp(native) },
          injectTo: 'head-prepend',
        },
      ];
    },
  };
}

export default defineConfig(({ mode }) => {
  // `npm run build:native` -> the bundle `npx cap sync` copies into the
  // Android and iOS projects. src/services/Platform.ts reads the same mode.
  const native = mode === 'native';
  return {
    base: './',
    plugins: [cspMeta(native)],
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
            // Capacitor runtime + plugins are deliberately NOT named here:
            // they are reached only through dynamic import()s inside the
            // wrapper, and left alone Rolldown emits them as lazy chunks.
            // Forcing them into a manual chunk drags Vite's preload helper
            // in with them and the web entry then preloads the lot.
            return undefined;
          },
        },
      },
    },
  };
});
