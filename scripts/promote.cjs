#!/usr/bin/env node
'use strict';

/**
 * promote.cjs — implementación de referencia del procedimiento de promoción de
 * reference/write-isolation.md ("El procedimiento"). Solo lo ejecuta el padre, nunca un
 * cazador ni un verificador.
 *
 * Subcomandos:
 *   init <dir-salida> <id-agente> --files a.txt,b.cjs [--per-file N] [--total N]
 *     Crea agents/<id>/scratch y agents/<id>/artifacts, y registra de antemano los
 *     nombres esperados y los límites en agents/<id>/expected-artifacts.json (fuera
 *     de scratch, así el agente no puede cambiarlos).
 *
 *   promote <dir-salida> <id-agente>
 *     Promueve cada archivo declarado desde scratch/ a artifacts/ e imprime un
 *     resumen JSON: {"promoted": [...], "absent": [...], "rejected": [{name, reason}]}.
 *
 * Alcance: solo nombres planos, sin subdirectorios, que es más estricto que el
 * procedimiento. Solo Linux: usa /proc/self/fd/<fd>/<nombre> con O_NOFOLLOW como
 * equivalente de openat() relativo a un descriptor retenido. En cualquier otra
 * plataforma no promueve nada (paso 11 del procedimiento).
 *
 * Códigos de salida: 0 si no hubo rechazos; 1 si se rechazó al menos un archivo;
 * 2 por argumentos inválidos o una plataforma sin las garantías necesarias.
 */

const fs = require('node:fs');
const path = require('node:path');

const C = fs.constants;
const AGENT_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/;
const FLAT_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const DEFAULT_PER_FILE = 64 * 1024;
const DEFAULT_TOTAL = 256 * 1024;
const MANIFEST = 'expected-artifacts.json';

class UsageError extends Error {}

function assertAgentId(id) {
  if (!AGENT_ID.test(id || '') || RESERVED.test(id)) {
    throw new UsageError(`id de agente inválido: ${JSON.stringify(id)}`);
  }
}

function assertFlatName(name) {
  // Paso 1: sin rutas absolutas, vacías, '.', '..' ni separadores.
  if (!FLAT_NAME.test(name) || name === '.' || name === '..' || name.includes('..')) {
    throw new UsageError(`nombre de artefacto inválido: ${JSON.stringify(name)} (solo nombres planos)`);
  }
}

function assertPlatform() {
  if (process.platform !== 'linux' || !fs.existsSync('/proc/self/fd')) {
    throw new UsageError('plataforma sin /proc/self/fd: no se puede promover con las garantías del procedimiento; registre la evidencia como needs_validation');
  }
}

function openDirNoFollow(p) {
  const fd = fs.openSync(p, C.O_RDONLY | C.O_DIRECTORY | C.O_NOFOLLOW | C.O_CLOEXEC);
  if (!fs.fstatSync(fd).isDirectory()) {
    fs.closeSync(fd);
    throw new Error(`${p} no es un directorio`);
  }
  return fd;
}

function openAt(dirFd, name, flags, mode) {
  return fs.openSync(`/proc/self/fd/${dirFd}/${name}`, flags | C.O_NOFOLLOW | C.O_CLOEXEC, mode);
}

function init(runDir, agentId, { files, perFile = DEFAULT_PER_FILE, total = DEFAULT_TOTAL }) {
  assertAgentId(agentId);
  if (!Array.isArray(files) || files.length === 0) throw new UsageError('init necesita --files con al menos un nombre');
  files.forEach(assertFlatName);
  if (!(perFile > 0) || !(total > 0)) throw new UsageError('los límites deben ser positivos');
  const root = path.join(runDir, 'agents', agentId);
  fs.mkdirSync(path.join(root, 'scratch'), { recursive: true });
  fs.mkdirSync(path.join(root, 'artifacts'), { recursive: true });
  const manifest = { files: [...new Set(files)], per_file_bytes: perFile, total_bytes: total };
  fs.writeFileSync(path.join(root, MANIFEST), `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' });
  return manifest;
}

function promoteOne(scratchFd, artifactsFd, name, limits, state) {
  let src;
  let dst;
  try {
    // Pasos 2-3: abrir relativo al descriptor retenido, no bloqueante, sin seguir enlaces.
    try {
      src = openAt(scratchFd, name, C.O_RDONLY | C.O_NONBLOCK);
    } catch (err) {
      if (err.code === 'ENOENT') return { status: 'absent' };
      if (err.code === 'ELOOP') return { status: 'rejected', reason: 'es un enlace simbólico' };
      throw err;
    }
    // Paso 4: archivo regular, un solo enlace, dentro de los límites.
    const st = fs.fstatSync(src);
    if (!st.isFile()) return { status: 'rejected', reason: 'no es un archivo regular' };
    if (st.nlink !== 1) return { status: 'rejected', reason: `tiene ${st.nlink} enlaces duros` };
    if (st.size > limits.per_file_bytes) return { status: 'rejected', reason: `excede el límite por archivo (${st.size} > ${limits.per_file_bytes})` };
    if (state.total + st.size > limits.total_bytes) return { status: 'rejected', reason: 'excede el límite acumulado' };

    // Pasos 5-6: leer exactamente el tamaño verificado y volver a comprobar la identidad.
    const buf = Buffer.alloc(st.size);
    let off = 0;
    while (off < st.size) {
      const n = fs.readSync(src, buf, off, st.size - off, off);
      if (n === 0) break;
      off += n;
    }
    if (off !== st.size || fs.readSync(src, Buffer.alloc(1), 0, 1, off) !== 0) {
      return { status: 'rejected', reason: 'el tamaño cambió durante la lectura' };
    }
    const st2 = fs.fstatSync(src);
    if (st2.ino !== st.ino || st2.dev !== st.dev || !st2.isFile() || st2.nlink !== 1 || st2.size !== st.size) {
      return { status: 'rejected', reason: 'la identidad del archivo cambió entre la verificación y la copia' };
    }

    // Pasos 7-8: crear el destino en forma exclusiva, sin seguir enlaces, y verificarlo.
    try {
      dst = openAt(artifactsFd, name, C.O_WRONLY | C.O_CREAT | C.O_EXCL, 0o644);
    } catch (err) {
      if (err.code === 'EEXIST') return { status: 'rejected', reason: 'ya existe en artifacts/' };
      throw err;
    }
    const dt = fs.fstatSync(dst);
    if (!dt.isFile() || dt.nlink !== 1) return { status: 'rejected', reason: 'el destino no es un archivo regular con un solo enlace' };
    fs.writeSync(dst, buf, 0, buf.length);
    state.total += st.size;
    return { status: 'promoted', bytes: st.size };
  } catch (err) {
    // Paso 11: ante cualquier falla, descartar sin promover.
    return { status: 'rejected', reason: `${err.code || 'error'}: ${err.message}` };
  } finally {
    if (src !== undefined) fs.closeSync(src);
    if (dst !== undefined) fs.closeSync(dst);
  }
}

function promote(runDir, agentId) {
  assertAgentId(agentId);
  assertPlatform();
  const agentsFd = openDirNoFollow(path.join(runDir, 'agents'));
  let agentFd;
  let scratchFd;
  let artifactsFd;
  try {
    agentFd = fs.openSync(`/proc/self/fd/${agentsFd}/${agentId}`, C.O_RDONLY | C.O_DIRECTORY | C.O_NOFOLLOW | C.O_CLOEXEC);
    const manifestFd = openAt(agentFd, MANIFEST, C.O_RDONLY);
    const limits = JSON.parse(fs.readFileSync(manifestFd, 'utf8'));
    fs.closeSync(manifestFd);
    limits.files.forEach(assertFlatName);
    scratchFd = fs.openSync(`/proc/self/fd/${agentFd}/scratch`, C.O_RDONLY | C.O_DIRECTORY | C.O_NOFOLLOW | C.O_CLOEXEC);
    artifactsFd = fs.openSync(`/proc/self/fd/${agentFd}/artifacts`, C.O_RDONLY | C.O_DIRECTORY | C.O_NOFOLLOW | C.O_CLOEXEC);

    const summary = { promoted: [], absent: [], rejected: [] };
    const state = { total: 0 };
    for (const name of limits.files) {
      const result = promoteOne(scratchFd, artifactsFd, name, limits, state);
      if (result.status === 'promoted') summary.promoted.push({ name, bytes: result.bytes });
      else if (result.status === 'absent') summary.absent.push(name);
      else summary.rejected.push({ name, reason: result.reason });
    }
    return summary;
  } finally {
    for (const fd of [artifactsFd, scratchFd, agentFd, agentsFd]) {
      if (fd !== undefined) fs.closeSync(fd);
    }
  }
}

function parseInitFlags(argv) {
  const opts = {};
  for (let i = 0; i < argv.length; i += 1) {
    const value = argv[i + 1];
    if (argv[i] === '--files') opts.files = (value || '').split(',').filter(Boolean);
    else if (argv[i] === '--per-file') opts.perFile = Number(value);
    else if (argv[i] === '--total') opts.total = Number(value);
    else throw new UsageError(`opción desconocida: ${argv[i]}`);
    i += 1;
  }
  return opts;
}

function main() {
  const [cmd, runDir, agentId, ...rest] = process.argv.slice(2);
  try {
    if (cmd === 'init' && runDir) {
      const manifest = init(path.resolve(runDir), agentId, parseInitFlags(rest));
      console.log(JSON.stringify(manifest));
      return;
    }
    if (cmd === 'promote' && runDir && rest.length === 0) {
      const summary = promote(path.resolve(runDir), agentId);
      console.log(JSON.stringify(summary, null, 2));
      process.exitCode = summary.rejected.length > 0 ? 1 : 0;
      return;
    }
    throw new UsageError('Uso: promote.cjs init <dir-salida> <id-agente> --files a,b [--per-file N] [--total N]\n       promote.cjs promote <dir-salida> <id-agente>');
  } catch (err) {
    console.error(`promote: ${err.message}`);
    process.exitCode = 2;
  }
}

module.exports = { init, promote };

if (require.main === module) {
  main();
}
