// @ts-check
import sitemap from '@astrojs/sitemap';
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
  // Inline the (small) stylesheets so no CSS request blocks the first paint.
  build: { format: 'directory', inlineStylesheets: 'always' },
  integrations: [sitemap({ filter: (page) => !/\/404\/?$|\/rules\/verapdf-\d/.test(page) })],
  devToolbar: { enabled: false },
  // Strict Content-Security-Policy, emitted by Astro as a <meta> tag on every
  // page with hashes for its own inline scripts and styles (no 'unsafe-inline'
  // for scripts). The browser check only talks to the reference indexes.
  security: {
    csp: {
      algorithm: 'SHA-256',
      directives: [
        "default-src 'self'",
        "connect-src 'self' https://api.crossref.org https://doi.org https://data.crossref.org https://export.arxiv.org https://dblp.org https://api.openalex.org",
        "img-src 'self' data:",
        "font-src 'self'",
        "worker-src 'self'",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
      ],
      scriptDirective: { resources: ["'self'"] },
      // Inline style attributes (e.g. widths set by the page) need 'unsafe-inline'
      // on style-src-attr only; <style> elements are hashed.
      styleDirective: {
        resources: ["'self'", { resource: "'unsafe-inline'", kind: 'attribute' }],
      },
    },
  },
  markdown: {
    shikiConfig: {
      theme: galleyTheme,
      wrap: false,
    },
  },
  vite: {
    build: { chunkSizeWarningLimit: 1600 },
    server: { fs: { allow: ['..'] } },
  },
});
