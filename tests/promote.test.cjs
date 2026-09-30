'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { init, promote } = require('../scripts/promote.cjs');

const linuxOnly = { skip: process.platform !== 'linux' && 'promote.cjs solo promueve en Linux' };

function freshRun() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'promote-test-'));
}

function scratch(runDir, agent, name) {
  return path.join(runDir, 'agents', agent, 'scratch', name);
}

test('init crea las raíces y el manifiesto fuera de scratch', () => {
  const run = freshRun();
  const manifest = init(run, 'hunter-a', { files: ['output-1.txt'] });
  assert.deepEqual(manifest.files, ['output-1.txt']);
  assert.ok(fs.statSync(path.join(run, 'agents/hunter-a/scratch')).isDirectory());
  assert.ok(fs.statSync(path.join(run, 'agents/hunter-a/artifacts')).isDirectory());
  assert.ok(fs.existsSync(path.join(run, 'agents/hunter-a/expected-artifacts.json')));
});

test('init rechaza ids de agente reservados o inválidos', () => {
  const run = freshRun();
  assert.throws(() => init(run, 'con', { files: ['a.txt'] }), /id de agente/);
  assert.throws(() => init(run, 'Hunter A', { files: ['a.txt'] }), /id de agente/);
});

test('init rechaza nombres con rutas o ..', () => {
  const run = freshRun();
  assert.throws(() => init(run, 'hunter-a', { files: ['../x'] }), /nombre de artefacto/);
  assert.throws(() => init(run, 'hunter-b', { files: ['sub/x.txt'] }), /nombre de artefacto/);
});

test('init no pisa un manifiesto existente', () => {
  const run = freshRun();
  init(run, 'hunter-a', { files: ['a.txt'] });
  assert.throws(() => init(run, 'hunter-a', { files: ['b.txt'] }), /EEXIST/);
});

test('promueve un archivo regular declarado', linuxOnly, () => {
  const run = freshRun();
  init(run, 'hunter-a', { files: ['output-1.txt'] });
  fs.writeFileSync(scratch(run, 'hunter-a', 'output-1.txt'), 'resultado');
  const summary = promote(run, 'hunter-a');
  assert.deepEqual(summary.promoted, [{ name: 'output-1.txt', bytes: 9 }]);
  assert.equal(fs.readFileSync(path.join(run, 'agents/hunter-a/artifacts/output-1.txt'), 'utf8'), 'resultado');
});

test('ignora archivos no declarados y reporta los declarados ausentes', linuxOnly, () => {
  const run = freshRun();
  init(run, 'hunter-a', { files: ['output-1.txt'] });
  fs.writeFileSync(scratch(run, 'hunter-a', 'intruso.txt'), 'x');
  const summary = promote(run, 'hunter-a');
  assert.deepEqual(summary.absent, ['output-1.txt']);
  assert.equal(fs.existsSync(path.join(run, 'agents/hunter-a/artifacts/intruso.txt')), false);
});

test('rechaza un enlace simbólico', linuxOnly, () => {
  const run = freshRun();
  init(run, 'hunter-a', { files: ['output-1.txt'] });
  fs.symlinkSync('/etc/hostname', scratch(run, 'hunter-a', 'output-1.txt'));
  const summary = promote(run, 'hunter-a');
  assert.equal(summary.rejected.length, 1);
  assert.match(summary.rejected[0].reason, /enlace simbólico/);
});

test('rechaza un archivo con varios enlaces duros', linuxOnly, () => {
  const run = freshRun();
  init(run, 'hunter-a', { files: ['output-1.txt'] });
  const other = path.join(run, 'agents/hunter-a/scratch/otro');
  fs.writeFileSync(other, 'x');
  fs.linkSync(other, scratch(run, 'hunter-a', 'output-1.txt'));
  const summary = promote(run, 'hunter-a');
  assert.match(summary.rejected[0].reason, /enlaces duros/);
});

test('rechaza un directorio con el nombre declarado', linuxOnly, () => {
  const run = freshRun();
  init(run, 'hunter-a', { files: ['output-1.txt'] });
  fs.mkdirSync(scratch(run, 'hunter-a', 'output-1.txt'));
  const summary = promote(run, 'hunter-a');
  assert.match(summary.rejected[0].reason, /regular/);
});

test('aplica el límite por archivo y el acumulado', linuxOnly, () => {
  const run = freshRun();
  init(run, 'hunter-a', { files: ['a.txt', 'b.txt', 'c.txt'], perFile: 10, total: 15 });
  fs.writeFileSync(scratch(run, 'hunter-a', 'a.txt'), '12345678');
  fs.writeFileSync(scratch(run, 'hunter-a', 'b.txt'), '12345678');
  fs.writeFileSync(scratch(run, 'hunter-a', 'c.txt'), '12345678901');
  const summary = promote(run, 'hunter-a');
  assert.deepEqual(summary.promoted.map((p) => p.name), ['a.txt']);
  const reasons = Object.fromEntries(summary.rejected.map((r) => [r.name, r.reason]));
  assert.match(reasons['b.txt'], /acumulado/);
  assert.match(reasons['c.txt'], /por archivo/);
});

test('no sobrescribe un artefacto ya promovido', linuxOnly, () => {
  const run = freshRun();
  init(run, 'hunter-a', { files: ['output-1.txt'] });
  fs.writeFileSync(scratch(run, 'hunter-a', 'output-1.txt'), 'uno');
  promote(run, 'hunter-a');
  fs.writeFileSync(scratch(run, 'hunter-a', 'output-1.txt'), 'dos');
  const summary = promote(run, 'hunter-a');
  assert.match(summary.rejected[0].reason, /ya existe/);
  assert.equal(fs.readFileSync(path.join(run, 'agents/hunter-a/artifacts/output-1.txt'), 'utf8'), 'uno');
});

test('no sigue un enlace simbólico en lugar del directorio scratch', linuxOnly, () => {
  const run = freshRun();
  init(run, 'hunter-a', { files: ['output-1.txt'] });
  const elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), 'promote-elsewhere-'));
  fs.writeFileSync(path.join(elsewhere, 'output-1.txt'), 'fuera');
  fs.rmSync(path.join(run, 'agents/hunter-a/scratch'), { recursive: true });
  fs.symlinkSync(elsewhere, path.join(run, 'agents/hunter-a/scratch'));
  assert.throws(() => promote(run, 'hunter-a'), /ELOOP|ENOTDIR/);
});
