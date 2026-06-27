import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const dist = join(root, 'dist');

mkdirSync(dist, { recursive: true });

const indexSource = join(root, 'index.html');
const indexTarget = join(dist, 'index.html');
let html = readFileSync(indexSource, 'utf8');
html = html.replace('./src/styles.css', './styles.css');
html = html.replace('./dist/main.js', './main.js');
writeFileSync(indexTarget, html);

copyFileSync(join(root, 'src', 'styles.css'), join(dist, 'styles.css'));

const publicSource = join(root, 'public');
const publicTarget = join(dist, 'public');
if (existsSync(publicTarget)) rmSync(publicTarget, { recursive: true, force: true });
if (existsSync(publicSource)) cpSync(publicSource, publicTarget, { recursive: true });
