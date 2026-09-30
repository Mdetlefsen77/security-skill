#!/usr/bin/env node
'use strict';

/**
 * Validador de threat-register.json sin dependencias externas.
 *
 * Usa schema-engine.cjs para schemas/threat-register.schema.json, y agrega las reglas
 * semánticas que el schema declarativo no puede expresar:
 * - threat_id es el hash de 'actor::asset::invariant' (NFC) truncado a 16 hex;
 * - cada priority_tier coincide con la tabla probabilidad × daño de phases/1-threat-model.md;
 * - el registro está ordenado por current_estimate.priority_tier y luego initial;
 * - coherencia entre estado y evidencia (investigated tiene rutas, dueño y ola;
 *   closed_no_finding no tiene candidatos vinculados; queued no tiene ni dueño
 *   ni ola asignada vigente);
 * - con findings.json: cada fingerprint publicado figura en su amenaza de origen;
 * - con --final: ninguna amenaza queda in_progress (la ejecución terminó).
 *
 * Uso:
 *   node validate-threat-register.cjs <threat-register.json> [findings.json] [--final]
 *
 * Código de salida 0 si no hay errores, 1 si hay al menos uno.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { maxDepth, validateAgainstSchema } = require('./schema-engine.cjs');

const MAX_FILE_BYTES = 5 * 1024 * 1024; // 5 MiB
const MAX_THREATS = 1000;
const MAX_NESTING_DEPTH = 64;
const MAX_REPORTED_ERRORS = 100;

const LEVELS = ['low', 'medium', 'high', 'critical'];
// Tabla de phases/1-threat-model.md: filas = probabilidad, columnas = daño.
const TIER_TABLE = [
  ['low', 'low', 'medium', 'high'],
  ['low', 'medium', 'high', 'high'],
  ['medium', 'high', 'high', 'critical'],
  ['high', 'high', 'critical', 'critical'],
];
const TIER_RANK = { critical: 0, high: 1, medium: 2, low: 3 };

function deriveTier(likelihood, impact) {
  const row = LEVELS.indexOf(likelihood);
  const col = LEVELS.indexOf(impact);
  if (row === -1 || col === -1) return null;
  return TIER_TABLE[row][col];
}

function threatIdFor(threat) {
  const key = `${threat.actor}::${threat.asset}::${threat.invariant}`.normalize('NFC');
  return crypto.createHash('sha256').update(key).digest('hex').slice(0, 16);
}

// ---------------------------------------------------------------------------
// Reglas semánticas
// ---------------------------------------------------------------------------

function checkThreatIdHash(threat, where, errors) {
  const expected = threatIdFor(threat);
  if (threat.threat_id !== expected) {
    errors.push(`${where}.threat_id: "${threat.threat_id}" no es el hash de actor::asset::invariant (se esperaba "${expected}")`);
  }
}

function checkTiers(threat, where, errors) {
  for (const key of ['initial_estimate', 'current_estimate']) {
    const est = threat[key];
    const tier = deriveTier(est.likelihood, est.impact);
    if (tier && est.priority_tier !== tier) {
      errors.push(`${where}.${key}.priority_tier: "${est.priority_tier}" no coincide con la tabla para ${est.likelihood} × ${est.impact} ("${tier}")`);
    }
  }
}

function checkStatusCoherence(threat, where, errors) {
  const { status } = threat;
  const linked = threat.linked_candidate_fingerprints.length;
  if (status === 'investigated') {
    if (threat.reviewed_paths.length === 0) {
      errors.push(`${where}: una amenaza "investigated" necesita reviewed_paths no vacío`);
    }
    if (!threat.agent_id) {
      errors.push(`${where}: una amenaza "investigated" necesita agent_id del cazador que la investigó`);
    }
    if (!Number.isInteger(threat.wave_assigned)) {
      errors.push(`${where}: una amenaza "investigated" necesita wave_assigned`);
    }
  }
  if (status === 'in_progress' && (!threat.agent_id || !Number.isInteger(threat.wave_assigned))) {
    errors.push(`${where}: una amenaza "in_progress" necesita agent_id y wave_assigned`);
  }
  if (status === 'closed_no_finding' && linked > 0) {
    errors.push(`${where}: una amenaza "closed_no_finding" no puede tener candidatos vinculados (${linked}); si se investigó y tuvo candidatos, su estado es "investigated"`);
  }
  if (status === 'queued' && linked > 0) {
    errors.push(`${where}: una amenaza "queued" tiene candidatos vinculados; reabrirla exige registrar la razón en reassessment_log y vaciar los vínculos de la ejecución anterior`);
  }
  const lastLogWave = threat.reassessment_log.reduce((max, entry) => Math.max(max, entry.wave), 0);
  if (threat.current_estimate.last_updated_wave < lastLogWave) {
    errors.push(`${where}.current_estimate.last_updated_wave (${threat.current_estimate.last_updated_wave}) es anterior a la última recalibración registrada (ola ${lastLogWave})`);
  }
}

function checkOrder(threats, errors) {
  for (let i = 1; i < threats.length; i += 1) {
    const a = threats[i - 1];
    const b = threats[i];
    const cur = TIER_RANK[a.current_estimate.priority_tier] - TIER_RANK[b.current_estimate.priority_tier];
    const ini = TIER_RANK[a.initial_estimate.priority_tier] - TIER_RANK[b.initial_estimate.priority_tier];
    if (cur > 0 || (cur === 0 && ini > 0)) {
      errors.push(`[${i}]: el registro no está ordenado por current_estimate.priority_tier (y luego initial_estimate): "${b.threat_id}" debería ir antes que "${a.threat_id}"`);
    }
  }
}

function checkUniqueIds(threats, errors) {
  const seenAt = new Map();
  threats.forEach((t, i) => {
    if (seenAt.has(t.threat_id)) {
      errors.push(`[${i}]: threat_id "${t.threat_id}" repetido — ya aparece en el índice ${seenAt.get(t.threat_id)}`);
    } else {
      seenAt.set(t.threat_id, i);
    }
  });
}

function checkFindingsLinked(threats, findings, errors) {
  if (!findings) return;
  const byId = new Map(threats.map((t) => [t.threat_id, t]));
  findings.forEach((record, i) => {
    if (!record || record.verdict === 'rejected') return;
    const threat = byId.get(record.threat_id);
    if (!threat) return; // validate-findings.cjs ya informa threat_id inexistente
    if (!threat.linked_candidate_fingerprints.includes(record.fingerprint)) {
      errors.push(`findings[${i}]: el fingerprint "${record.fingerprint}" no figura en linked_candidate_fingerprints de la amenaza "${record.threat_id}"`);
    }
    if (threat.status !== 'investigated') {
      errors.push(`findings[${i}]: la amenaza "${record.threat_id}" tiene un registro "${record.verdict}" publicado pero su estado es "${threat.status}", no "investigated"`);
    }
  });
}

function checkFinal(threats, errors) {
  threats.forEach((t, i) => {
    if (t.status === 'in_progress') {
      errors.push(`[${i}]: "${t.threat_id}" sigue "in_progress" al cierre de la ejecución; debe tener disposición final o volver a "queued" como riesgo residual`);
    }
  });
}

// ---------------------------------------------------------------------------
// Punto de entrada
// ---------------------------------------------------------------------------

function validateThreatRegister(threats, schema, { findings = null, final = false } = {}) {
  const errors = [];
  if (!Array.isArray(threats)) {
    return ['El nivel superior de threat-register.json debe ser un arreglo'];
  }
  if (threats.length > MAX_THREATS) {
    errors.push(`threat-register.json tiene ${threats.length} amenazas, el máximo soportado es ${MAX_THREATS}`);
  }
  if (maxDepth(threats) > MAX_NESTING_DEPTH) {
    errors.push(`threat-register.json excede la profundidad de anidamiento máxima (${MAX_NESTING_DEPTH})`);
  }

  let structurallyValid = true;
  threats.forEach((threat, i) => {
    const where = `[${i}]`;
    const before = errors.length;
    validateAgainstSchema(threat, schema.items, where, errors);
    if (errors.length !== before) {
      structurallyValid = false;
      return;
    }
    checkThreatIdHash(threat, where, errors);
    checkTiers(threat, where, errors);
    checkStatusCoherence(threat, where, errors);
  });

  // Las reglas que cruzan amenazas solo tienen sentido si todas pasaron la estructura.
  if (structurallyValid) {
    checkUniqueIds(threats, errors);
    checkOrder(threats, errors);
    checkFindingsLinked(threats, Array.isArray(findings) ? findings : null, errors);
    if (final) checkFinal(threats, errors);
  }
  return errors;
}

function readJson(file, label) {
  const stat = fs.statSync(file);
  if (stat.size > MAX_FILE_BYTES) {
    throw new Error(`${label} pesa ${stat.size} bytes, el máximo soportado es ${MAX_FILE_BYTES}`);
  }
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function main() {
  const args = process.argv.slice(2);
  const final = args.includes('--final');
  const [registerArg, findingsArg] = args.filter((a) => a !== '--final');
  if (!registerArg) {
    console.error('Uso: node validate-threat-register.cjs <threat-register.json> [findings.json] [--final]');
    process.exit(1);
  }

  let threats;
  let findings = null;
  let schema;
  try {
    threats = readJson(path.resolve(registerArg), 'threat-register.json');
    if (findingsArg) findings = readJson(path.resolve(findingsArg), 'findings.json');
    schema = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'schemas', 'threat-register.schema.json'), 'utf8'));
  } catch (err) {
    console.error(`No se pudo leer la entrada: ${err.message}`);
    process.exit(1);
  }

  const errors = validateThreatRegister(threats, schema, { findings, final });
  if (errors.length === 0) {
    console.log(`OK: ${threats.length} amenaza(s) válidas en ${registerArg}`);
    process.exit(0);
  }
  console.error(`${errors.length} error(es) en ${registerArg}:`);
  errors.slice(0, MAX_REPORTED_ERRORS).forEach((e) => console.error(`  - ${e}`));
  if (errors.length > MAX_REPORTED_ERRORS) {
    console.error(`  ... y ${errors.length - MAX_REPORTED_ERRORS} error(es) más (truncado a ${MAX_REPORTED_ERRORS})`);
  }
  process.exit(1);
}

module.exports = { validateThreatRegister, deriveTier, threatIdFor };

if (require.main === module) {
  main();
}
