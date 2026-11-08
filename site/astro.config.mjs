// @ts-check
import { defineConfig } from 'astro/config';
import { galleyTheme } from './src/lib/shiki-theme.mjs';

// Deployed at https://amet13.github.io/overfull/. Override for local preview:
//   SITE_BASE=/ pnpm --filter site build
const rawBase = process.env.SITE_BASE ?? '/overfull';
const base = rawBase === '/' ? '/' : `/${rawBase.replace(/^\/+|\/+$/g, '')}`;

export default defineConfig({
  site: process.env.SITE_URL ?? 'https://amet13.github.io',
  base,
  trailingSlash: 'always',
  build: { format: 'directory' },
  devToolbar: { enabled: false },
  markdown: {
    shikiConfig: {
      theme: galleyTheme,
      wrap: false,
    },
  },
  vite: {
    // DEV ONLY (remove): point at a patched core build while core is in progress.
    ...(process.env.OVERFULL_CORE_SHIM ? { resolve: { alias: { '@overfull/core': process.env.OVERFULL_CORE_SHIM } } } : {}),
    build: { chunkSizeWarningLimit: 1600 },
    server: { fs: { allow: ['..'] } },
  },
});
