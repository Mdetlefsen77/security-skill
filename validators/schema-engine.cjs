'use strict';

/**
 * Motor de validación de JSON Schema (subconjunto) compartido por
 * validate-findings.cjs, validate-cross-repo.cjs y validate-threat-register.cjs. Única fuente de verdad —
 * si corrige una regla acá, se corrige para los dos validadores a la vez.
 *
 * Soporta: type (string o lista de tipos), properties/required/additionalProperties, enum, const,
 * pattern, minLength, minItems/maxItems/uniqueItems, minimum, minProperties,
 * items, oneOf, y el keyword custom `visibleContent`.
 */

const MAX_NESTING_DEPTH = 64;

function typeOf(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function maxDepth(value, depth = 0) {
  if (depth > MAX_NESTING_DEPTH) return depth;
  if (value !== null && typeof value === 'object') {
    const children = Array.isArray(value) ? value : Object.values(value);
    let deepest = depth;
    for (const child of children) {
      const d = maxDepth(child, depth + 1);
      if (d > deepest) deepest = d;
      if (deepest > MAX_NESTING_DEPTH) break;
    }
    return deepest;
  }
  return depth;
}

/** Contenido legible real: no vacío tras recortar, tiene al menos una letra
 * o dígito Unicode, y no contiene caracteres de control ni el carácter de
 * reemplazo U+FFFD (síntoma típico de corrupción de encoding). */
function isVisibleContent(str) {
  if (typeof str !== 'string') return false;
  const trimmed = str.trim();
  if (trimmed.length === 0) return false;
  if (/\uFFFD/.test(str)) return false;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(str)) return false;
  if (!/[\p{L}\p{N}]/u.test(str)) return false;
  return true;
}

/**
 * Valida `data` contra `schema` y agrega mensajes de error a `errors`
 * (con el JSON Pointer `where` como prefijo). Devuelve true si no encontró
 * ningún error nuevo.
 */
function validateAgainstSchema(data, schema, where, errors) {
  const startErrorCount = errors.length;

  if (schema.oneOf) {
    const attempts = schema.oneOf.map((sub) => {
      const subErrors = [];
      validateAgainstSchema(data, sub, where, subErrors);
      return subErrors;
    });
    const passing = attempts.filter((subErrors) => subErrors.length === 0);
    if (passing.length === 1) {
      return true;
    }
    if (passing.length > 1) {
      errors.push(`${where}: coincide con más de una rama de oneOf (ambiguo)`);
      return false;
    }
    const best = attempts.reduce((a, b) => (b.length < a.length ? b : a));
    errors.push(`${where}: no coincide con ninguna rama de oneOf. Rama más cercana: ${best.join('; ')}`);
    return false;
  }

  if (schema.const !== undefined) {
    if (data !== schema.const) {
      errors.push(`${where}: se esperaba el valor constante ${JSON.stringify(schema.const)}, se encontró ${JSON.stringify(data)}`);
    }
  }

  if (schema.enum) {
    if (!schema.enum.includes(data)) {
      errors.push(`${where}: ${JSON.stringify(data)} no está en el enum permitido [${schema.enum.join(', ')}]`);
    }
  }

  // `type` puede ser un string o una lista de tipos (p. ej. ["integer", "null"]).
  // `type` pasa a ser el tipo que efectivamente coincidió, para que las reglas de abajo
  // se apliquen según ese tipo.
  let type = schema.type;
  if (type) {
    const actual = typeOf(data);
    const matches = (t) => (t === 'integer' ? actual === 'number' && Number.isInteger(data) : actual === t);
    const candidates = Array.isArray(type) ? type : [type];
    const matched = candidates.find(matches);
    if (matched === undefined) {
      errors.push(`${where}: se esperaba tipo "${candidates.join('" o "')}", se encontró "${actual}"`);
      return errors.length === startErrorCount;
    }
    type = matched;
  }

  if (type === 'string') {
    if (schema.minLength !== undefined && data.length < schema.minLength) {
      errors.push(`${where}: longitud ${data.length} menor que minLength ${schema.minLength}`);
    }
    if (schema.pattern !== undefined) {
      const re = new RegExp(schema.pattern);
      if (!re.test(data)) {
        errors.push(`${where}: "${data}" no coincide con el patrón ${schema.pattern}`);
      }
    }
    if (schema.visibleContent && !isVisibleContent(data)) {
      errors.push(`${where}: se esperaba contenido legible real (visibleContent), se encontró texto vacío, ilegible, o con caracteres de control`);
    }
  }

  if (type === 'integer' && schema.minimum !== undefined && data < schema.minimum) {
    errors.push(`${where}: ${data} es menor que el mínimo ${schema.minimum}`);
  }

  if (type === 'array') {
    if (schema.minItems !== undefined && data.length < schema.minItems) {
      errors.push(`${where}: tiene ${data.length} elementos, se requieren al menos ${schema.minItems}`);
    }
    if (schema.maxItems !== undefined && data.length > schema.maxItems) {
      errors.push(`${where}: tiene ${data.length} elementos, se permiten como máximo ${schema.maxItems}`);
    }
    if (schema.uniqueItems) {
      const seen = new Set();
      data.forEach((item, i) => {
        const key = JSON.stringify(item);
        if (seen.has(key)) {
          errors.push(`${where}[${i}]: elemento duplicado, uniqueItems lo prohíbe`);
        }
        seen.add(key);
      });
    }
    if (schema.items) {
      data.forEach((item, i) => {
        validateAgainstSchema(item, schema.items, `${where}[${i}]`, errors);
      });
    }
  }

  if (type === 'object') {
    const keys = Object.keys(data);
    if (schema.minProperties !== undefined && keys.length < schema.minProperties) {
      errors.push(`${where}: tiene ${keys.length} propiedades, se requieren al menos ${schema.minProperties}`);
    }
    if (schema.required) {
      for (const key of schema.required) {
        if (!(key in data)) {
          errors.push(`${where}: falta la propiedad requerida "${key}"`);
        }
      }
    }
    if (schema.properties) {
      for (const [key, subSchema] of Object.entries(schema.properties)) {
        if (key in data) {
          validateAgainstSchema(data[key], subSchema, `${where}.${key}`, errors);
        }
      }
    }
    if (schema.additionalProperties === false) {
      const allowed = new Set(Object.keys(schema.properties || {}));
      for (const key of keys) {
        if (!allowed.has(key)) {
          errors.push(`${where}: propiedad no permitida "${key}" (additionalProperties: false)`);
        }
      }
    }
  }

  return errors.length === startErrorCount;
}

module.exports = {
  MAX_NESTING_DEPTH,
  typeOf,
  maxDepth,
  isVisibleContent,
  validateAgainstSchema,
};
