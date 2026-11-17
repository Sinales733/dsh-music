// Build dsh-music into lib/:
//   lib/client.js  browser half, src/client/* concatenated into the DSH lazy client-module format
//   lib/index.js, lib/lyrics.js, lib/bridge.ps1  host half, copied as they are
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
fs.mkdirSync(path.join(root, 'lib'), { recursive: true });

// src/client/island.js (the small player unfolding from the capsule) is set aside for now and not built in. To bring
// it back, put it in the list after bars.js: music.js uses it whenever createIsland is defined.
// The whale tail (vendor rig from dsh-motion, groove = its beat-locked motion, tail = on screen) comes before
// music.js, which starts it when createTail is defined.
const body = ['src/client/remote.js', 'src/client/backdrop.js', 'src/client/vendor/rig-model.js', 'src/client/vendor/surface.js',
  'src/client/groove.js', 'src/client/vendor/sway-frames.js', 'src/client/swaybeat.js', 'src/client/tail.js', 'src/client/ctxline.js', 'src/client/bars.js', 'src/client/glow.js', 'src/client/music.js'].map(read).join('\n');
const client = `window.__ModuleLoader__.load({
\tid: ${JSON.stringify(pkg.name)},
\tfactory: (require) => {
\t\tvar module = { exports: {} };
\t\tvar exports = module.exports;
\t\tObject.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
${body.split('\n').map((l) => (l ? '\t\t' + l : l)).join('\n')}
\t\treturn module.exports;
\t}
});
`;
fs.writeFileSync(path.join(root, 'lib/client.js'), client);
for (const f of ['index.js', 'lyrics.js', 'ncm.js', 'songs.js', 'mood.js', 'bridge.ps1']) fs.copyFileSync(path.join(root, 'src/host', f), path.join(root, 'lib', f));
const size = (f) => fs.statSync(path.join(root, 'lib', f)).size;
console.log(['client.js', 'index.js', 'lyrics.js', 'bridge.ps1'].map((f) => `${f} ${(size(f) / 1024).toFixed(1)}KB`).join(', '));
