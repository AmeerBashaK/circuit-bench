// Copies the built web app (Output/dist, from `npm run build` in the repo root) into a packaging project:
//   node packaging/copy-web.mjs desktop   ->  packaging/desktop/app
//   node packaging/copy-web.mjs android   ->  packaging/android/www
import { cpSync, existsSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const target = { desktop: join(here, 'desktop', 'app'), android: join(here, 'android', 'www') }[process.argv[2]];
const dist = join(here, '..', 'Output', 'dist');
if (!target) { console.error('Usage: node packaging/copy-web.mjs <desktop|android>'); process.exit(1); }
if (!existsSync(join(dist, 'index.html'))) { console.error('Output/dist is missing. Run `npm run build` in the repo root first.'); process.exit(1); }
rmSync(target, { recursive: true, force: true });
cpSync(dist, target, { recursive: true });
// The desktop window uses the app icon at runtime, so it travels with the app files.
if (process.argv[2] === 'desktop') cpSync(join(here, 'icon', 'icon.png'), join(here, 'desktop', 'icon.png'));
console.log(`Copied ${dist} -> ${target}`);
