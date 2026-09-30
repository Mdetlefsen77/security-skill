'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { validateThreatRegister, deriveTier, threatIdFor } = require('../validators/validate-threat-register.cjs');

const schema = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'schemas', 'threat-register.schema.json'), 'utf8'));

function baseThreat(overrides = {}) {
  const threat = {
    actor: 'usuario autenticado sin rol administrativo',
    asset: 'expediente de otro contribuyente',
    invariant: 'un usuario solo puede leer o escribir expedientes de los que es titular',
    why_it_matters: 'acceso indebido a datos personales y fiscales de terceros',
    candidate_starting_paths: ['src/api/expedientes.ts'],
    initial_estimate: {
      likelihood: 'medium',
      likelihood_reason: 'requiere autenticación de un usuario ordinario',
      impact: 'high',
      impact_reason: 'datos de más de un principal',
      priority_tier: 'high',
    },
    current_estimate: { likelihood: 'medium', impact: 'high', priority_tier: 'high', last_updated_wave: 0 },
    status: 'queued',
    source: 'reconnaissance',
    wave_assigned: null,
    agent_id: null,
    reviewed_paths: [],
    linked_candidate_fingerprints: [],
    reassessment_log: [],
    ...overrides,
  };
  if (!('threat_id' in overrides)) threat.threat_id = threatIdFor(threat);
  return threat;
}

function investigated(overrides = {}) {
  return baseThreat({
    status: 'investigated',
    wave_assigned: 1,
    agent_id: 'hunter-a',
    reviewed_paths: ['src/api/expedientes.ts'],
    checks: [
      { agent_id: 'hunter-a', reviewed_paths: ['src/api/expedientes.ts'], invariant_checked: 'propiedad del expediente', method: 'source', result: 'no hay chequeo de owner_id', artifact: null },
    ],
    ...overrides,
  });
}

test('una amenaza queued válida pasa sin errores', () => {
  assert.deepEqual(validateThreatRegister([baseThreat()], schema), []);
});

test('una amenaza investigated con checks y unresolved pasa', () => {
  assert.deepEqual(validateThreatRegister([investigated({ unresolved: ['exposición de red externa'] })], schema), []);
});

test('threat_id que no es el hash de actor::asset::invariant -> falla', () => {
  const errors = validateThreatRegister([baseThreat({ threat_id: '0000000000000000' })], schema);
  assert.ok(errors.some((e) => e.includes('no es el hash')));
});

test('threat_id ilustrativo TH-001 -> falla por patrón', () => {
  const errors = validateThreatRegister([baseThreat({ threat_id: 'TH-001' })], schema);
  assert.ok(errors.some((e) => e.includes('patrón')));
});

test('priority_tier que no coincide con la tabla -> falla', () => {
  const t = baseThreat();
  t.current_estimate.priority_tier = 'critical';
  const errors = validateThreatRegister([t], schema);
  assert.ok(errors.some((e) => e.includes('no coincide con la tabla')));
});

test('deriveTier reproduce las esquinas de la tabla de phases/1-threat-model.md', () => {
  assert.equal(deriveTier('low', 'low'), 'low');
  assert.equal(deriveTier('low', 'critical'), 'high');
  assert.equal(deriveTier('critical', 'low'), 'high');
  assert.equal(deriveTier('critical', 'critical'), 'critical');
  assert.equal(deriveTier('medium', 'high'), 'high');
});

test('registro desordenado por prioridad -> falla', () => {
  const low = baseThreat({
    actor: 'operador interno',
    initial_estimate: { likelihood: 'low', likelihood_reason: 'rol interno', impact: 'low', impact_reason: 'detalle interno', priority_tier: 'low' },
    current_estimate: { likelihood: 'low', impact: 'low', priority_tier: 'low', last_updated_wave: 0 },
  });
  const errors = validateThreatRegister([low, baseThreat()], schema);
  assert.ok(errors.some((e) => e.includes('no está ordenado')));
});

test('investigated sin reviewed_paths ni agent_id -> falla', () => {
  const errors = validateThreatRegister([investigated({ reviewed_paths: [], agent_id: null })], schema);
  assert.ok(errors.some((e) => e.includes('reviewed_paths')));
  assert.ok(errors.some((e) => e.includes('agent_id')));
});

test('closed_no_finding con candidatos vinculados -> falla', () => {
  const errors = validateThreatRegister([investigated({ status: 'closed_no_finding', linked_candidate_fingerprints: ['fp-1'] })], schema);
  assert.ok(errors.some((e) => e.includes('closed_no_finding')));
});

test('last_updated_wave anterior a la última recalibración -> falla', () => {
  const t = investigated({ reassessment_log: [{ wave: 2, reason: 'se confirmó un candidato relacionado' }] });
  t.current_estimate.last_updated_wave = 1;
  const errors = validateThreatRegister([t], schema);
  assert.ok(errors.some((e) => e.includes('last_updated_wave')));
});

test('campo no declarado -> falla por additionalProperties', () => {
  const errors = validateThreatRegister([baseThreat({ notas: 'libre' })], schema);
  assert.ok(errors.some((e) => e.includes('notas')));
});

test('finding publicado cuyo fingerprint no está vinculado a la amenaza -> falla', () => {
  const t = investigated({ linked_candidate_fingerprints: [] });
  const findings = [{ verdict: 'confirmed', threat_id: t.threat_id, fingerprint: 'fp-1' }];
  const errors = validateThreatRegister([t], schema, { findings });
  assert.ok(errors.some((e) => e.includes('linked_candidate_fingerprints')));
});

test('finding publicado vinculado a una amenaza investigated -> pasa', () => {
  const t = investigated({ linked_candidate_fingerprints: ['fp-1'] });
  const findings = [{ verdict: 'confirmed', threat_id: t.threat_id, fingerprint: 'fp-1' }];
  assert.deepEqual(validateThreatRegister([t], schema, { findings }), []);
});

test('--final con una amenaza in_progress -> falla', () => {
  const t = baseThreat({ status: 'in_progress', wave_assigned: 1, agent_id: 'hunter-a' });
  assert.deepEqual(validateThreatRegister([t], schema), []);
  const errors = validateThreatRegister([t], schema, { final: true });
  assert.ok(errors.some((e) => e.includes('in_progress')));
});

test('threat_id repetido -> falla', () => {
  const errors = validateThreatRegister([baseThreat(), baseThreat()], schema);
  assert.ok(errors.some((e) => e.includes('repetido')));
});

test('el nivel superior debe ser un arreglo', () => {
  const errors = validateThreatRegister({}, schema);
  assert.ok(errors.length === 1 && errors[0].includes('arreglo'));
});
