// Copies the repo's templates/ into packages/cli/templates for publishing.
// Run after `tsc` (it uses the compiled copy logic): `node scripts/copy-templates.mjs`.
import { existsSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { copyTemplate, TEMPLATE_NAMES } from '../dist/templates.js';

const pkg = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = join(pkg, '..', '..', 'templates');
const target = join(pkg, 'templates');

if (!existsSync(source)) {
  console.error(`templates not found at ${source}`);
  process.exit(1);
}
rmSync(target, { recursive: true, force: true });
for (const name of TEMPLATE_NAMES) {
  if (!existsSync(join(source, name))) {
    console.error(`missing template: ${name}`);
    process.exit(1);
  }
  copyTemplate(join(source, name), join(target, name));
  console.log(`templates/${name}`);
}
