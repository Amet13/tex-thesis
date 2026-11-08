// @ts-check
import { defineConfig } from 'astro/config';
import { galleyTheme } from './src/lib/shiki-theme.mjs';
import { rehypeDocLinks } from './src/lib/rehype-doc-links.mjs';

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
    rehypePlugins: [[rehypeDocLinks, { base }]],
  },
  vite: {
    build: { chunkSizeWarningLimit: 1600 },
    server: { fs: { allow: ['..'] } },
  },
});
