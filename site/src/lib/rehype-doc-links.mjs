// Rewrites links between Markdown guide pages (`./checks.md#refs`) to site URLs
// (`/overfull/docs/checks/#refs`), and links that escape docs/guide to GitHub.
const REPO = 'https://github.com/amet13/overfull/blob/main';

function walk(node, fn) {
  fn(node);
  if (node.children) for (const c of node.children) walk(c, fn);
}

export function rehypeDocLinks({ base = '/' } = {}) {
  const prefix = base.endsWith('/') ? base : `${base}/`;
  return (tree, file) => {
    // Path of the current doc relative to docs/guide, e.g. "checks/references.md".
    const fromPath = String(file?.path ?? '').replace(/\\/g, '/');
    const idx = fromPath.lastIndexOf('/docs/guide/');
    const rel = idx >= 0 ? fromPath.slice(idx + '/docs/guide/'.length) : '';
    const dir = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/') + 1) : '';
    walk(tree, (node) => {
      if (node.type !== 'element' || node.tagName !== 'a') return;
      const href = node.properties?.href;
      if (typeof href !== 'string' || /^[a-z]+:|^\/\/|^#/i.test(href)) return;
      const [pathPart, hash = ''] = href.split('#');
      if (!pathPart || !pathPart.endsWith('.md')) return;
      const parts = (dir + pathPart).split('/');
      const out = [];
      for (const p of parts) {
        if (p === '..') {
          if (out.length === 0) out.push('..');
          else if (out[out.length - 1] === '..') out.push('..');
          else out.pop();
        } else if (p !== '.' && p !== '') out.push(p);
      }
      const h = hash ? `#${hash}` : '';
      if (out[0] === '..') {
        // Outside docs/guide: docs/ARCHITECTURE.md, README.md, …
        let up = 0;
        while (out[0] === '..') { out.shift(); up++; }
        const target = up === 1 ? `docs/${out.join('/')}` : out.join('/');
        node.properties.href = `${REPO}/${target}${h}`;
        return;
      }
      let slug = out.join('/').replace(/\.md$/, '').toLowerCase();
      slug = slug.replace(/(^|\/)index$/, '');
      node.properties.href = `${prefix}docs/${slug ? `${slug}/` : ''}${h}`;
    });
  };
}
