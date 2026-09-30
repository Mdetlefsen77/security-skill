#!/usr/bin/env node
'use strict';

/**
 * Validador de findings.json sin dependencias externas.
 *
 * Usa schema-engine.cjs para la parte declarativa del schema, y agrega las
 * reglas semánticas que schemas/findings.schema.json no puede expresar por sí solo:
 * orden de la traza (entrypoint+ → propagation* → sink+), que la severidad
 * general nunca exceda el impacto demostrado, que cada fingerprint aparezca
 * una sola vez en el archivo, y que cada `threat_id` exista en
 * threat-register.json cuando se lo provee.
 *
 * Uso:
 *   node validate-findings.cjs <findings.json> [threat-register.json]
 *
 * Código de salida 0 si no hay errores, 1 si hay al menos uno.
 */

const fs = require('fs');
const path = require('path');
const { maxDepth, validateAgainstSchema } = require('./schema-engine.cjs');

const MAX_FILE_BYTES = 5 * 1024 * 1024; // 5 MiB
const MAX_TOP_LEVEL_FINDINGS = 1000;
const MAX_NESTING_DEPTH = 64;
const MAX_REPORTED_ERRORS = 100;

const SEVERITY_ORDER = ['informational', 'low', 'medium', 'high', 'critical'];

// ---------------------------------------------------------------------------
// Reglas semánticas que el schema declarativo no puede expresar
// ---------------------------------------------------------------------------

function checkTraceOrder(record, where, errors) {
  const trace = record.trace;
  if (!Array.isArray(trace) || trace.length === 0) return;
  if (trace.length === 1) {
    const kind = trace[0].kind;
    if (kind !== 'entrypoint' && kind !== 'sink') {
      errors.push(`${where}.trace[0]: una traza de una sola entrada debe ser "entrypoint" o "sink", se encontró "${kind}"`);
    }
    return;
  }
  // Forma: entrypoint+ propagation* sink+. Varios entrypoints (p. ej. POST, PATCH y DELETE
  // hermanos que comparten la misma causa raíz) van agrupados al principio, y sus sinks
  // agrupados al final; lo único prohibido es intercalar los grupos.
  if (trace[0].kind !== 'entrypoint') {
    errors.push(`${where}.trace[0]: una traza de varias entradas debe empezar en "entrypoint", se encontró "${trace[0].kind}"`);
  }
  const last = trace.length - 1;
  if (trace[last].kind !== 'sink') {
    errors.push(`${where}.trace[${last}]: una traza de varias entradas debe terminar en "sink", se encontró "${trace[last].kind}"`);
  }
  const GROUP = { entrypoint: 0, propagation: 1, sink: 2 };
  for (let i = 1; i < trace.length; i += 1) {
    const prev = GROUP[trace[i - 1].kind];
    const curr = GROUP[trace[i].kind];
    if (curr < prev) {
      errors.push(`${where}.trace[${i}]: "${trace[i].kind}" no puede aparecer después de "${trace[i - 1].kind}"; el orden es entrypoint+ → propagation* → sink+`);
    }
  }
  const entrypoints = trace.filter((step) => step.kind === 'entrypoint').length;
  const hasPropagation = trace.some((step) => step.kind === 'propagation');
  if (entrypoints > 1 && !hasPropagation) {
    errors.push(`${where}.trace: con varios entrypoints hace falta al menos un paso "propagation" que muestre dónde convergen los caminos`);
  }
}

function checkSeverityNotAboveImpact(record, where, errors) {
  const severity = record.severity;
  if (!severity || !severity.impact || !severity.overall_severity) return;
  const impactRank = SEVERITY_ORDER.indexOf(severity.impact.score);
  const overallRank = SEVERITY_ORDER.indexOf(severity.overall_severity);
  if (impactRank === -1 || overallRank === -1) return;
  if (overallRank > impactRank) {
    errors.push(`${where}.severity: overall_severity ("${severity.overall_severity}") no puede superar el impacto demostrado ("${severity.impact.score}")`);
  }
}

function checkFingerprintUniqueness(records, errors) {
  const seenAt = new Map();
  records.forEach((record, i) => {
    if (typeof record.fingerprint !== 'string') return;
    if (seenAt.has(record.fingerprint)) {
      errors.push(`[${i}]: fingerprint "${record.fingerprint}" repetido — ya aparece en el índice ${seenAt.get(record.fingerprint)}. Debe haber un único registro final por fingerprint.`);
    } else {
      seenAt.set(record.fingerprint, i);
    }
  });
}

function checkThreatIdsExist(records, threatIds, errors) {
  if (!threatIds) return;
  records.forEach((record, i) => {
    if (typeof record.threat_id !== 'string') return;
    if (!threatIds.has(record.threat_id)) {
      errors.push(`[${i}]: threat_id "${record.threat_id}" no existe en threat-register.json`);
    }
  });
}

// ---------------------------------------------------------------------------
// Carga de archivos y punto de entrada
// ---------------------------------------------------------------------------

function loadThreatIds(threatRegisterPath) {
  if (!threatRegisterPath) return null;
  const raw = fs.readFileSync(threatRegisterPath, 'utf8');
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error('threat-register.json debe ser un arreglo de nivel superior');
  }
  return new Set(parsed.map((t) => t.threat_id).filter((id) => typeof id === 'string'));
}

function validateFindings(findings, schema, threatIds) {
  const errors = [];

  if (!Array.isArray(findings)) {
    return ['El nivel superior de findings.json debe ser un arreglo'];
  }
  if (findings.length > MAX_TOP_LEVEL_FINDINGS) {
    errors.push(`findings.json tiene ${findings.length} registros, el máximo soportado es ${MAX_TOP_LEVEL_FINDINGS}`);
  }
  const depth = maxDepth(findings);
  if (depth > MAX_NESTING_DEPTH) {
    errors.push(`findings.json excede la profundidad de anidamiento máxima (${MAX_NESTING_DEPTH})`);
  }

  const itemSchema = schema.items;
  findings.forEach((record, i) => {
    const where = `[${i}]`;
    const before = errors.length;
    validateAgainstSchema(record, itemSchema, where, errors);
    if (errors.length === before && record && typeof record === 'object') {
      checkTraceOrder(record, where, errors);
      if (record.verdict === 'confirmed') {
        checkSeverityNotAboveImpact(record, where, errors);
      }
    }
  });

  checkFingerprintUniqueness(findings, errors);
  checkThreatIdsExist(findings, threatIds, errors);

  return errors;
}

function main() {
  const [, , findingsPathArg, threatRegisterPathArg] = process.argv;

  if (!findingsPathArg) {
    console.error('Uso: node validate-findings.cjs <findings.json> [threat-register.json]');
    process.exit(1);
  }

  const findingsPath = path.resolve(findingsPathArg);
  const schemaPath = path.join(__dirname, '..', 'schemas', 'findings.schema.json');

  let stat;
  try {
    stat = fs.statSync(findingsPath);
  } catch (err) {
    console.error(`No se pudo leer ${findingsPath}: ${err.message}`);
    process.exit(1);
  }
  if (stat.size > MAX_FILE_BYTES) {
    console.error(`${findingsPath} pesa ${stat.size} bytes, el máximo soportado es ${MAX_FILE_BYTES}`);
    process.exit(1);
  }

  let findings;
  let schema;
  try {
    findings = JSON.parse(fs.readFileSync(findingsPath, 'utf8'));
    schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
  } catch (err) {
    console.error(`Error de parseo JSON: ${err.message}`);
    process.exit(1);
  }

  let threatIds = null;
  if (threatRegisterPathArg) {
    try {
      threatIds = loadThreatIds(path.resolve(threatRegisterPathArg));
    } catch (err) {
      console.error(`No se pudo leer threat-register.json: ${err.message}`);
      process.exit(1);
    }
  }

  const errors = validateFindings(findings, schema, threatIds);

  if (errors.length === 0) {
    console.log(`OK: ${findings.length} registro(s) válidos en ${findingsPathArg}`);
    process.exit(0);
  }

  console.error(`${errors.length} error(es) en ${findingsPathArg}:`);
  errors.slice(0, MAX_REPORTED_ERRORS).forEach((e) => console.error(`  - ${e}`));
  if (errors.length > MAX_REPORTED_ERRORS) {
    console.error(`  ... y ${errors.length - MAX_REPORTED_ERRORS} error(es) más (truncado a ${MAX_REPORTED_ERRORS})`);
  }
  process.exit(1);
}

module.exports = { validateFindings, checkTraceOrder, checkSeverityNotAboveImpact };

if (require.main === module) {
  main();
}
