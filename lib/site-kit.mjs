// What it takes to assemble pages outside the static build (editor preview, page function):
// site settings, layouts, special-block templates, starting content and asset versions.
// Local use and tests read the files; the build writes lib/generated/site-kit.json for the functions.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

export function readKitFiles(root) {
  const src = join(root, 'src');
  const read = (p) => readFileSync(p, 'utf8');
  const config = JSON.parse(read(join(src, 'site.config.json')));
  const layouts = { it: read(join(src, 'partials/layout.it.html')), en: read(join(src, 'partials/layout.en.html')) };
  const specialDir = join(src, 'partials/special');
  const specials = statSync(specialDir, { throwIfNoEntry: false })
    ? Object.fromEntries(readdirSync(specialDir).filter((f) => f.endsWith('.html')).map((f) => [f.replace(/\.html$/, ''), read(join(specialDir, f))]))
    : {};
  const content = [];
  for (const lang of ['it', 'en']) {
    const dir = join(root, 'content', 'pages', lang);
    if (!statSync(dir, { throwIfNoEntry: false })) continue;
    for (const f of readdirSync(dir).filter((x) => x.endsWith('.json'))) content.push({ ...JSON.parse(read(join(dir, f))), lang });
  }
  return { config, layouts, specials, content, hashes: {} };
}

/** Kit with a catalogue loader (from the database when there is one, else the demo catalogue in the settings). */
export function withCatalog(kit, loadCatalog) {
  const demo = () => {
    const cat = kit.config.demoCatalog;
    const map = new Map();
    for (const c of cat.categories) for (const sv of c.services) for (const p of sv.professionals) if (!map.has(p.id)) map.set(p.id, { ...p });
    return { ...cat, professionals: [...map.values()] };
  };
  return { ...kit, loadCatalog: async () => (loadCatalog ? loadCatalog().catch(() => demo()) : demo()) };
}
