'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { validateFindings, checkTraceOrder, checkSeverityNotAboveImpact } = require('../validators/validate-findings.cjs');
const { isVisibleContent } = require('../validators/schema-engine.cjs');

const schema = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'schemas', 'findings.schema.json'), 'utf8'));

function baseConfirmed(overrides = {}) {
  const record = {
    verdict: 'confirmed',
    threat_id: 'a3f1c9d20b7e4488',
    fingerprint: 'src/api/expedientes.ts:42:missing-owner-check',
    title: 'Falta de verificación de propietario en GET /expedientes/:id',
    description: 'Cualquier usuario autenticado puede leer el expediente de otro usuario cambiando el id en la URL.',
    root_cause: 'El handler no compara el owner_id del expediente con el usuario autenticado.',
    intended_behavior: 'Solo el titular del expediente debería poder leerlo.',
    trace: [
      { kind: 'entrypoint', file: 'src/api/expedientes.ts', line: 40, scope: 'handler', description: 'Recibe el id sin validar propiedad.' },
      { kind: 'sink', file: 'src/api/expedientes.ts', line: 42, scope: 'consulta', description: 'Devuelve el expediente sin filtrar por owner_id.' },
    ],
    evidence: [{ file: 'src/api/expedientes.ts', line: 42, description: 'La consulta no incluye WHERE owner_id.' }],
    conditions: [{ kind: 'authentication_level', description: 'Requiere solo autenticación básica.' }],
    execution: {
      attacker_perspective: 'Un usuario autenticado sin privilegios especiales.',
      payloads: ['GET /expedientes/999'],
      instructions: ['Autenticarse como usuario A.', 'Solicitar el expediente 999 de usuario B.'],
      observed_result: 'La respuesta 200 incluye el expediente completo de B.',
    },
    remediation: { strategy: 'Agregar WHERE owner_id = :usuario_actual a la consulta.' },
    severity: {
      likelihood: { score: 'high', reason: 'Alcanzable por cualquier usuario autenticado.' },
      impact: { score: 'high', reason: 'Expone datos personales de otro usuario.' },
      overall_severity: 'high',
    },
    confidence: { score: 'high', reason: 'Reproducido localmente.' },
  };
  return { ...record, ...overrides };
}

function baseNeedsValidation(overrides = {}) {
  const record = {
    verdict: 'needs_validation',
    threat_id: 'a3f1c9d20b7e4488',
    fingerprint: 'src/foo.ts:10:missing-config',
    title: 'Posible falta de validación de configuración en producción',
    description: 'El código confía en una variable de entorno que no se ve en el repositorio.',
    claimed_root_cause: 'No hay forma de saber desde el código si FEATURE_X está deshabilitada en producción.',
    trace: [{ kind: 'entrypoint', file: 'src/foo.ts', line: 10, scope: 'arranque', description: 'Lee process.env.FEATURE_X.' }],
    evidence: [{ file: 'src/foo.ts', line: 10, description: 'if (process.env.FEATURE_X) { ... }' }],
    blockers: ['No se puede observar el valor real de FEATURE_X en producción desde el repositorio.'],
    validation_plan: { deployment: 'Pedirle a infraestructura que confirme el valor en producción.' },
  };
  return { ...record, ...overrides };
}

test('un registro confirmed válido pasa sin errores', () => {
  const errors = validateFindings([baseConfirmed()], schema, null);
  assert.deepEqual(errors, []);
});

test('un registro needs_validation válido pasa sin errores', () => {
  const errors = validateFindings([baseNeedsValidation()], schema, null);
  assert.deepEqual(errors, []);
});

test('falta threat_id -> falla', () => {
  const record = baseConfirmed();
  delete record.threat_id;
  const errors = validateFindings([record], schema, null);
  assert.ok(errors.length > 0);
  assert.match(errors[0], /threat_id/);
});

test('propiedad no declarada -> falla por additionalProperties', () => {
  const record = baseConfirmed({ campo_inventado: 'no debería estar acá' });
  const errors = validateFindings([record], schema, null);
  assert.ok(errors.some((e) => e.includes('campo_inventado')));
});

test('severity.overall_severity por encima del impacto demostrado -> falla', () => {
  const record = baseConfirmed();
  record.severity.overall_severity = 'critical'; // impact sigue en "high"
  const errors = validateFindings([record], schema, null);
  assert.ok(errors.some((e) => e.includes('overall_severity')));
});

test('severity.overall_severity igual o menor al impacto -> pasa', () => {
  const record = baseConfirmed();
  record.severity.overall_severity = 'medium'; // menor que impact "high", debe ser válido
  const errors = validateFindings([record], schema, null);
  assert.deepEqual(errors, []);
});

test('traza de dos pasos que no termina en sink -> falla', () => {
  const record = baseConfirmed();
  record.trace[1].kind = 'entrypoint';
  const errors = validateFindings([record], schema, null);
  assert.ok(errors.some((e) => e.includes('sink')));
});

test('traza de un solo paso con kind "propagation" -> falla', () => {
  const record = baseConfirmed();
  record.trace = [{ kind: 'propagation', file: 'x', line: 1, scope: 'y', description: 'z' }];
  const errors = validateFindings([record], schema, null);
  assert.ok(errors.some((e) => e.includes('entrypoint') || e.includes('sink')));
});

test('fingerprint duplicado entre dos registros -> falla', () => {
  const a = baseConfirmed();
  const b = baseConfirmed();
  const errors = validateFindings([a, b], schema, null);
  assert.ok(errors.some((e) => e.includes('repetido')));
});

test('título vacío tras recortar espacios -> falla por visibleContent', () => {
  const record = baseConfirmed({ title: '   ' });
  const errors = validateFindings([record], schema, null);
  assert.ok(errors.some((e) => e.includes('visibleContent') || e.includes('contenido legible')));
});

test('validation_plan vacío en needs_validation -> falla por minProperties', () => {
  const record = baseNeedsValidation({ validation_plan: {} });
  const errors = validateFindings([record], schema, null);
  assert.ok(errors.some((e) => e.includes('validation_plan')));
});

test('threat_id que no existe en threat-register.json -> falla', () => {
  const threatIds = new Set(['otro-id-distinto']);
  const errors = validateFindings([baseConfirmed()], schema, threatIds);
  assert.ok(errors.some((e) => e.includes('no existe en threat-register.json')));
});

test('threat_id que sí existe en threat-register.json -> pasa', () => {
  const threatIds = new Set(['a3f1c9d20b7e4488']);
  const errors = validateFindings([baseConfirmed()], schema, threatIds);
  assert.deepEqual(errors, []);
});

test('isVisibleContent rechaza strings de solo símbolos o control', () => {
  assert.equal(isVisibleContent('   '), false);
  assert.equal(isVisibleContent(''), false);
  assert.equal(isVisibleContent('!!!---'), false);
  assert.equal(isVisibleContent('texto real 123'), true);
});

test('pattern_id válido (slug en minúsculas) se acepta', () => {
  const record = baseConfirmed({ pattern_id: 'no-rate-limit-on-credentials-login' });
  const errors = validateFindings([record], schema, null);
  assert.deepEqual(errors, []);
});

test('pattern_id con mayúsculas o espacios se rechaza', () => {
  const record = baseConfirmed({ pattern_id: 'No Rate Limit' });
  const errors = validateFindings([record], schema, null);
  assert.ok(errors.length > 0);
});

test('el nivel superior debe ser un arreglo', () => {
  const errors = validateFindings({ not: 'an array' }, schema, null);
  assert.ok(errors.length === 1 && errors[0].includes('arreglo'));
});

test('traza con varios entrypoints hermanos que convergen -> pasa', () => {
  const record = baseConfirmed();
  record.trace = [
    { kind: 'entrypoint', file: 'src/api/x.ts', line: 10, scope: 'POST', description: 'Alta sin control.' },
    { kind: 'entrypoint', file: 'src/api/x.ts', line: 20, scope: 'DELETE', description: 'Baja sin control.' },
    { kind: 'propagation', file: 'src/seq.ts', line: 5, scope: 'pipeline', description: 'No se autentica la ruta.' },
    { kind: 'sink', file: 'src/api/x.ts', line: 12, scope: 'create', description: 'INSERT en la tabla.' },
    { kind: 'sink', file: 'src/api/x.ts', line: 22, scope: 'delete', description: 'DELETE en la tabla.' },
  ];
  assert.deepEqual(validateFindings([record], schema, null), []);
});

test('traza con entrypoint intercalado después de propagation -> falla', () => {
  const record = baseConfirmed();
  record.trace = [
    { kind: 'entrypoint', file: 'a', line: 1, scope: 'a', description: 'entrada uno' },
    { kind: 'propagation', file: 'b', line: 1, scope: 'b', description: 'paso intermedio' },
    { kind: 'entrypoint', file: 'c', line: 1, scope: 'c', description: 'entrada dos' },
    { kind: 'sink', file: 'd', line: 1, scope: 'd', description: 'efecto final' },
  ];
  const errors = validateFindings([record], schema, null);
  assert.ok(errors.some((e) => e.includes('no puede aparecer después')));
});

test('traza con varios entrypoints sin propagation -> falla', () => {
  const record = baseConfirmed();
  record.trace = [
    { kind: 'entrypoint', file: 'a', line: 1, scope: 'a', description: 'entrada uno' },
    { kind: 'entrypoint', file: 'b', line: 1, scope: 'b', description: 'entrada dos' },
    { kind: 'sink', file: 'c', line: 1, scope: 'c', description: 'efecto final' },
  ];
  const errors = validateFindings([record], schema, null);
  assert.ok(errors.some((e) => e.includes('convergen')));
});
