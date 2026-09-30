'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { validateCrossRepo } = require('../validators/validate-cross-repo.cjs');

const schema = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'schemas', 'cross-repo.schema.json'), 'utf8'));

function basePattern(overrides = {}) {
  const pattern = {
    pattern_id: 'no-rate-limit-on-credentials-login',
    description: 'El endpoint de login de credenciales no aplica ningún límite de intentos por cuenta o IP, permitiendo fuerza bruta o credential stuffing sin fricción.',
    technique: 'falta de rate limiting en autenticación',
    stack_signals: ['next-auth', 'credentials provider', 'bcryptjs'],
    occurrences: [
      {
        repo: 'vecindar',
        fingerprint: 'src/lib/auth.ts:9:no-rate-limit-on-login',
        verdict_at_time: 'needs_validation',
        run_id: 'run-1',
        date: '2026-09-18',
      },
    ],
  };
  return { ...pattern, ...overrides };
}

test('un patrón válido con una ocurrencia pasa sin errores', () => {
  const errors = validateCrossRepo([basePattern()], schema);
  assert.deepEqual(errors, []);
});

test('un patrón con varias ocurrencias en repos distintos pasa sin errores', () => {
  const pattern = basePattern({
    occurrences: [
      { repo: 'vecindar', fingerprint: 'a:1:x', verdict_at_time: 'needs_validation', run_id: 'run-1', date: '2026-09-18' },
      { repo: 'monitorio', fingerprint: 'b:2:y', verdict_at_time: 'confirmed', run_id: 'run-4', date: '2026-09-20' },
    ],
  });
  const errors = validateCrossRepo([pattern], schema);
  assert.deepEqual(errors, []);
});

test('pattern_id con mayúsculas o guion bajo se rechaza', () => {
  const pattern = basePattern({ pattern_id: 'No_Rate_Limit' });
  const errors = validateCrossRepo([pattern], schema);
  assert.ok(errors.length > 0);
});

test('falta stack_signals -> falla (requerido)', () => {
  const pattern = basePattern();
  delete pattern.stack_signals;
  const errors = validateCrossRepo([pattern], schema);
  assert.ok(errors.some((e) => e.includes('stack_signals')));
});

test('occurrences vacío -> falla (minItems: 1)', () => {
  const pattern = basePattern({ occurrences: [] });
  const errors = validateCrossRepo([pattern], schema);
  assert.ok(errors.length > 0);
});

test('propiedad no declarada -> falla por additionalProperties', () => {
  const pattern = basePattern({ notas_internas_del_cliente: 'esto no debería estar acá' });
  const errors = validateCrossRepo([pattern], schema);
  assert.ok(errors.some((e) => e.includes('notas_internas_del_cliente')));
});

test('fecha con formato inválido en una ocurrencia -> falla', () => {
  const pattern = basePattern();
  pattern.occurrences[0].date = '18/09/2026';
  const errors = validateCrossRepo([pattern], schema);
  assert.ok(errors.length > 0);
});

test('pattern_id duplicado entre dos patrones -> falla', () => {
  const a = basePattern();
  const b = basePattern({ description: 'Otra descripción distinta pero mismo pattern_id.' });
  const errors = validateCrossRepo([a, b], schema);
  assert.ok(errors.some((e) => e.includes('repetido')));
});

test('el nombre de un repo listado en occurrences filtrado a description -> falla', () => {
  const pattern = basePattern({
    description: 'En vecindar, el endpoint de login de credenciales no aplica ningún límite de intentos.',
  });
  const errors = validateCrossRepo([pattern], schema);
  assert.ok(errors.some((e) => e.includes('description') && e.includes('vecindar')));
});

test('el nombre de un repo listado en occurrences filtrado a technique -> falla', () => {
  const pattern = basePattern({ technique: 'falta de rate limiting (visto en vecindar)' });
  const errors = validateCrossRepo([pattern], schema);
  assert.ok(errors.some((e) => e.includes('technique') && e.includes('vecindar')));
});

test('una descripción genérica que no menciona ningún repo pasa sin errores', () => {
  const errors = validateCrossRepo([basePattern()], schema);
  assert.deepEqual(errors, []);
});

test('el nivel superior debe ser un arreglo', () => {
  const errors = validateCrossRepo({ not: 'an array' }, schema);
  assert.ok(errors.length === 1 && errors[0].includes('arreglo'));
});
