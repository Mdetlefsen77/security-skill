'use strict';

// Integridad de la documentación: links relativos, anchors, rutas citadas y nombres viejos.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const SKILL_DIRS = ['phases', 'prompts', 'reference', 'schemas', 'validators', 'scripts', 'tests'];
const OLD_NAMES = [
  'THREAT-MODEL.md', 'HUNTING.md', 'VALIDATION-AND-REPORTING.md', 'WRITE-ISOLATION.md',
  'CROSS-REPO.md', 'ATTACK-CLASSES.md', 'DIFF-MODE.md',
  'report-schema.json', 'cross-repo-schema.json', 'threat-register-schema.json',
];

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

const files = walk(ROOT);
const markdown = files.filter((f) => f.endsWith('.md'));
const rel = (f) => path.relative(ROOT, f);

// Slug al estilo de GitHub: minúsculas, sin puntuación salvo guiones, espacios a guiones.
function slug(heading) {
  return heading
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s/g, '-');
}

function anchorsOf(file) {
  const anchors = new Set();
  let inFence = false;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (line.startsWith('```')) inFence = !inFence;
    const m = !inFence && /^#{1,6}\s+(.*)$/.exec(line);
    if (m) anchors.add(slug(m[1]));
  }
  return anchors;
}

function stripFences(text) {
  return text.replace(/```[\s\S]*?```/g, '');
}

test('todo link relativo de Markdown apunta a un archivo y anchor existentes', () => {
  const broken = [];
  for (const file of markdown) {
    const text = stripFences(fs.readFileSync(file, 'utf8'));
    for (const m of text.matchAll(/\]\(([^)\s]+)\)/g)) {
      const target = m[1];
      if (/^[a-z]+:/i.test(target)) continue; // http:, mailto:, etc.
      const [p, frag] = target.split('#');
      const dest = p ? path.resolve(path.dirname(file), p) : file;
      if (!fs.existsSync(dest)) {
        broken.push(`${rel(file)}: ${target} (no existe)`);
      } else if (frag && dest.endsWith('.md') && !anchorsOf(dest).has(frag)) {
        broken.push(`${rel(file)}: ${target} (no existe el anchor)`);
      }
    }
  }
  assert.deepEqual(broken, []);
});

test('toda ruta de la skill citada entre backticks existe', () => {
  const pattern = new RegExp('`((?:' + SKILL_DIRS.join('|') + ')/[A-Za-z0-9._/-]+)`', 'g');
  const missing = [];
  for (const file of markdown) {
    const text = fs.readFileSync(file, 'utf8');
    for (const m of text.matchAll(pattern)) {
      const cited = m[1].replace(/\/$/, '');
      if (!fs.existsSync(path.join(ROOT, cited))) missing.push(`${rel(file)}: ${cited}`);
    }
  }
  assert.deepEqual(missing, []);
});

test('no quedan menciones a nombres de archivo anteriores a la reestructuración', () => {
  const stale = [];
  for (const file of files) {
    if (file === __filename || !/\.(md|cjs|json)$/.test(file)) continue;
    const text = fs.readFileSync(file, 'utf8');
    for (const name of OLD_NAMES) {
      if (text.includes(name)) stale.push(`${rel(file)}: ${name}`);
    }
  }
  assert.deepEqual(stale, []);
});
