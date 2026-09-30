#!/usr/bin/env node
'use strict';

/**
 * Validador de cross-repo-patterns.json sin dependencias externas.
 *
 * Usa schema-engine.cjs para la parte declarativa, y agrega las reglas
 * semánticas que el schema no puede expresar: pattern_id único en todo el
 * archivo, cada patrón con al menos una ocurrencia real, y — la comprobación
 * que existe para prevenir la fuga entre clientes/organizaciones — que
 * `description` y `technique` no contengan ningún nombre de repo listado en
 * `occurrences` (si el nombre del repo aparece en la descripción genérica,
 * probablemente alguien copió detalle específico de un repo a un campo que
 * se supone que es repo-neutral).
 *
 * Uso:
 *   node validate-cross-repo.cjs <cross-repo-patterns.json>
 *
 * Código de salida 0 si no hay errores, 1 si hay al menos uno.
 */

const fs = require('fs');
const path = require('path');
const { maxDepth, validateAgainstSchema } = require('./schema-engine.cjs');

const MAX_FILE_BYTES = 2 * 1024 * 1024; // 2 MiB — este store crece mucho más lento que findings.json
const MAX_TOP_LEVEL_PATTERNS = 2000;
const MAX_NESTING_DEPTH = 64;
const MAX_REPORTED_ERRORS = 100;

function checkPatternIdUniqueness(patterns, errors) {
  const seenAt = new Map();
  patterns.forEach((p, i) => {
    if (typeof p.pattern_id !== 'string') return;
    if (seenAt.has(p.pattern_id)) {
      errors.push(`[${i}]: pattern_id "${p.pattern_id}" repetido — ya aparece en el índice ${seenAt.get(p.pattern_id)}. Cada patrón debe tener un pattern_id único; agregue la ocurrencia nueva al patrón existente en vez de crear uno duplicado.`);
    } else {
      seenAt.set(p.pattern_id, i);
    }
  });
}

/** Evita que el nombre de un repo se filtre a un campo que debe ser
 * repo-neutral (description, technique) — la razón de ser de este store es
 * poder compartir el mecanismo de falla sin exponer de qué repo salió a
 * quien no debería saberlo. */
function checkNoRepoNameLeaksIntoGenericFields(patterns, errors) {
  patterns.forEach((p, i) => {
    if (!Array.isArray(p.occurrences)) return;
    const repoNames = p.occurrences
      .map((o) => o && o.repo)
      .filter((r) => typeof r === 'string' && r.trim().length >= 3);
    for (const repo of repoNames) {
      const needle = repo.toLowerCase();
      if (typeof p.description === 'string' && p.description.toLowerCase().includes(needle)) {
        errors.push(`[${i}].description: contiene el nombre de repo "${repo}" — este campo debe describir el mecanismo de falla en términos genéricos, no identificar de qué repo salió.`);
      }
      if (typeof p.technique === 'string' && p.technique.toLowerCase().includes(needle)) {
        errors.push(`[${i}].technique: contiene el nombre de repo "${repo}" — este campo debe ser repo-neutral.`);
      }
    }
  });
}

function validateCrossRepo(patterns, schema) {
  const errors = [];

  if (!Array.isArray(patterns)) {
    return ['El nivel superior de cross-repo-patterns.json debe ser un arreglo'];
  }
  if (patterns.length > MAX_TOP_LEVEL_PATTERNS) {
    errors.push(`cross-repo-patterns.json tiene ${patterns.length} patrones, el máximo soportado es ${MAX_TOP_LEVEL_PATTERNS}`);
  }
  const depth = maxDepth(patterns);
  if (depth > MAX_NESTING_DEPTH) {
    errors.push(`cross-repo-patterns.json excede la profundidad de anidamiento máxima (${MAX_NESTING_DEPTH})`);
  }

  const itemSchema = schema.items;
  patterns.forEach((p, i) => {
    validateAgainstSchema(p, itemSchema, `[${i}]`, errors);
  });

  checkPatternIdUniqueness(patterns, errors);
  checkNoRepoNameLeaksIntoGenericFields(patterns, errors);

  return errors;
}

function main() {
  const [, , patternsPathArg] = process.argv;

  if (!patternsPathArg) {
    console.error('Uso: node validate-cross-repo.cjs <cross-repo-patterns.json>');
    process.exit(1);
  }

  const patternsPath = path.resolve(patternsPathArg);
  const schemaPath = path.join(__dirname, '..', 'schemas', 'cross-repo.schema.json');

  let stat;
  try {
    stat = fs.statSync(patternsPath);
  } catch (err) {
    console.error(`No se pudo leer ${patternsPath}: ${err.message}`);
    process.exit(1);
  }
  if (stat.size > MAX_FILE_BYTES) {
    console.error(`${patternsPath} pesa ${stat.size} bytes, el máximo soportado es ${MAX_FILE_BYTES}`);
    process.exit(1);
  }

  let patterns;
  let schema;
  try {
    patterns = JSON.parse(fs.readFileSync(patternsPath, 'utf8'));
    schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
  } catch (err) {
    console.error(`Error de parseo JSON: ${err.message}`);
    process.exit(1);
  }

  const errors = validateCrossRepo(patterns, schema);

  if (errors.length === 0) {
    console.log(`OK: ${patterns.length} patrón(es) válidos en ${patternsPathArg}`);
    process.exit(0);
  }

  console.error(`${errors.length} error(es) en ${patternsPathArg}:`);
  errors.slice(0, MAX_REPORTED_ERRORS).forEach((e) => console.error(`  - ${e}`));
  if (errors.length > MAX_REPORTED_ERRORS) {
    console.error(`  ... y ${errors.length - MAX_REPORTED_ERRORS} error(es) más (truncado a ${MAX_REPORTED_ERRORS})`);
  }
  process.exit(1);
}

module.exports = { validateCrossRepo, checkPatternIdUniqueness, checkNoRepoNameLeaksIntoGenericFields };

if (require.main === module) {
  main();
}
