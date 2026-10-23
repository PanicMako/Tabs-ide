import { mkdir, readFile, writeFile, copyFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, join } from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));
const extension = root;
const prototype = resolve(extension, '../../prototypes/relay');
const staged = join(extension, 'package');
await mkdir(join(staged, 'dist/fonts'), { recursive: true });
const sources = ['state.js', 'studio-state.js', 'appearances.js', 'views.js', 'app.js', 'organization.js', 'features.js', 'controls.js', 'welcome.js', 'rich-fields.js', 'template-builder.js', 'template-interactions.js', 'board.js', 'search.js', 'location.js', 'ux.js'];
let code = (await readFile(join(extension, 'runtime.js'), 'utf8'))+'\n';
code += (await readFile(join(prototype, 'operations.mjs'), 'utf8')).replaceAll('export function ', 'function ')+'\n';
for (const name of sources) {
  let content = await readFile(join(prototype, name), 'utf8');
  if (name === 'features.js') content = content.replace(/^import .*?;\n/, '');
  content = content.replace("document.querySelector('#app').innerHTML=R.studio();", "document.querySelector('#app').innerHTML=relayMarkup(R.studio());");
  content = content.replace('modalContent.innerHTML=html;', 'modalContent.innerHTML=relayMarkup(html);');
  content = content.replace("Your workspace is back. All five directions use these notes.", 'Your workspace is back.');
  content = content.replaceAll('browser-only design prototype', 'local Tabs notebook').replaceAll('in this prototype', 'in Relay').replaceAll('prototype limit', 'attachment limit');
  code += '\n'+content+'\n';
}
code += await readFile(join(extension, 'integration.js'), 'utf8');
const compiled = new Bun.Transpiler({loader:'js',target:'browser'}).transformSync('(()=>{\n'+code+'\n})();');
await writeFile(join(staged, 'dist/relay.js'), compiled);
let html = await readFile(join(prototype, 'index.html'), 'utf8');
html = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '').replace('</body>', '<script src="relay.js"></script></body>');
html = html.replace('</head>', '<link id="relay-runtime-styles" rel="stylesheet" href="runtime.css"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'self\'; style-src \'self\'; img-src \'self\' data:; font-src \'self\'; connect-src \'none\'; object-src \'none\'; frame-src \'none\'; form-action \'none\'; base-uri \'none\'"></head>');
await writeFile(join(staged, 'dist/index.html'), html);
for (const name of ['styles.css', 'appearances.css', 'typography.css', 'local-fonts.css', 'organization.css', 'features.css', 'controls.css', 'ux.css']) await copyFile(join(prototype, name), join(staged, 'dist', name));
await writeFile(join(staged, 'dist/runtime.css'), '.relay-runtime-ready{color:inherit}\n.backup-text{width:100%;min-height:280px;font:11px/1.7 var(--mono);padding:15px;border:1px solid var(--line);border-radius:7px;background:var(--surface);color:var(--ink)}\n');
// Only the active direction's two type families are shipped, with their licenses.
const fonts = (await readdir(join(prototype, 'fonts'))).filter(name => /bricolage|dm-?sans/i.test(name));
if (fonts.length < 4) throw new Error('Missing font binaries or license files.');
for (const name of fonts) await copyFile(join(prototype, 'fonts', name), join(staged, 'dist/fonts', name));
const fontCSS = await readFile(join(prototype, 'local-fonts.css'), 'utf8');
await writeFile(join(staged, 'dist/local-fonts.css'), [...fontCSS.matchAll(/@font-face\s*\{[^}]+\}/g)].map(match=>match[0]).filter(rule=>/bricolage|dm-?sans/i.test(rule)).join('\n'));
for (const name of ['tabs-extension.json', 'README.md', 'PRIVACY.md']) await copyFile(join(extension, name), join(staged, name));
await copyFile(join(extension, 'assets/icon.png'), join(staged, 'icon.png'));
await copyFile(join(extension, 'assets/tool.svg'), join(staged, 'tool.svg'));
console.log(`Built Relay at ${staged}`);
