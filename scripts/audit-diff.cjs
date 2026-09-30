#!/usr/bin/env node
'use strict';

/**
 * audit-diff.cjs — wrapper de "modo diff" para risk-led-security-audit.
 *
 * Acota una corrida de la habilidad a los archivos tocados por un diff de Git
 * (en vez de una auditoría completa del repositorio), la invoca de forma no
 * interactiva vía `claude -p` (modo headless), y decide un código de salida
 * a partir de findings.json — para usarse como paso de CI o como gate antes
 * de archivar un cambio de OpenSpec.
 *
 * Cero dependencias externas. Requiere: git, node >=18, el binario `claude`
 * en PATH (o pasado con --claude-bin).
 *
 * Documentación completa: ../reference/diff-mode.md
 */

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const SKILL_DIR = path.resolve(__dirname, '..');

// ---------------------------------------------------------------------------
// Parseo de argumentos (sin dependencias)
// ---------------------------------------------------------------------------

function printUsageAndExit(code) {
  const usage = `
Uso: node audit-diff.cjs [opciones]

Modo de alcance (elija uno; por defecto --diff HEAD):
  --diff <ref-base>          Audita los archivos cambiados entre <ref-base> y el
                              árbol de trabajo (equivalente a git diff --name-only <ref-base>).
  --diff-range <a>..<b>      Audita los archivos cambiados entre dos referencias.
  --staged                   Audita solo lo que está en stage (git diff --cached).
  --openspec <ruta-o-nombre> Carpeta de cambio de OpenSpec (ej: openspec/changes/mi-cambio
                              o solo "mi-cambio" si existe bajo openspec/changes/).
                              Se usa como CONTEXTO adicional del prompt (proposal.md,
                              design.md) — el alcance de archivos sigue viniendo de
                              --diff/--diff-range/--staged, combínelos.

Opciones generales:
  --repo <ruta>               Raíz del repo objetivo. Por defecto: cwd.
  --repo-name <nombre>        Identificador del repo para rutas de salida. Por defecto:
                               nombre del remoto origin o del directorio.
  --output <ruta>             Directorio de salida. Por defecto:
                               ~/risk-led-security-audit/<repo-name>/diff-run-<timestamp>
  --pattern-scope <id>        Scope cross-repo a consultar/alimentar (ver reference/cross-repo.md).
  --risk-floor <tier>         Piso de riesgo: low | medium | high | critical. Por defecto: low.
  --mode <informative|gate>   informative: nunca falla el proceso, solo informa (por defecto).
                               gate: exit code != 0 si hay un finding confirmed >= --fail-on.
  --fail-on <severidad>       Severidad mínima que hace fallar el modo gate. Por defecto: high.
  --max-turns <n>             Pasado directo a "claude -p --max-turns".
  --max-budget-usd <n>        Pasado directo a "claude -p --max-budget-usd".
  --model <id>                Pasado directo a "claude -p --model".
  --claude-bin <ruta>         Binario de claude a invocar. Por defecto: "claude" en PATH.
  --allow-write               Permite que el propio wrapper le dé al agente permiso de
                               escritura sobre el directorio de salida (necesario para que
                               escriba findings.json). Sin esta bandera se aborta antes de
                               invocar claude — es una confirmación explícita, no un default.
  --dry-run                   Arma el alcance, el prompt y el comando, los imprime, y termina
                               sin invocar claude. No gasta presupuesto ni requiere red.
  --extra-ignore <patrón>     Patrón glob adicional a excluir del alcance (repetible).
  -h, --help                  Muestra esta ayuda.
`;
  process.stdout.write(usage);
  process.exit(code);
}

function parseArgs(argv) {
  const opts = {
    repo: process.cwd(),
    diffBase: null,
    diffRange: null,
    staged: false,
    openspec: null,
    repoName: null,
    output: null,
    patternScope: null,
    riskFloor: 'low',
    mode: 'informative',
    failOn: 'high',
    maxTurns: null,
    maxBudgetUsd: null,
    model: null,
    claudeBin: 'claude',
    allowWrite: false,
    dryRun: false,
    extraIgnore: [],
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    switch (a) {
      case '--diff': opts.diffBase = next(); break;
      case '--diff-range': opts.diffRange = next(); break;
      case '--staged': opts.staged = true; break;
      case '--openspec': opts.openspec = next(); break;
      case '--repo': opts.repo = path.resolve(next()); break;
      case '--repo-name': opts.repoName = next(); break;
      case '--output': opts.output = path.resolve(next()); break;
      case '--pattern-scope': opts.patternScope = next(); break;
      case '--risk-floor': opts.riskFloor = next(); break;
      case '--mode': opts.mode = next(); break;
      case '--fail-on': opts.failOn = next(); break;
      case '--max-turns': opts.maxTurns = next(); break;
      case '--max-budget-usd': opts.maxBudgetUsd = next(); break;
      case '--model': opts.model = next(); break;
      case '--claude-bin': opts.claudeBin = next(); break;
      case '--allow-write': opts.allowWrite = true; break;
      case '--dry-run': opts.dryRun = true; break;
      case '--extra-ignore': opts.extraIgnore.push(next()); break;
      case '-h':
      case '--help': printUsageAndExit(0); break;
      default:
        process.stderr.write(`Opción desconocida: ${a}\n`);
        printUsageAndExit(1);
    }
  }

  if (!opts.diffBase && !opts.diffRange && !opts.staged) {
    opts.diffBase = 'HEAD';
  }

  const validModes = ['informative', 'gate'];
  if (!validModes.includes(opts.mode)) {
    fail(`--mode debe ser "informative" o "gate", recibido: ${opts.mode}`);
  }
  const severities = ['informational', 'low', 'medium', 'high', 'critical'];
  if (!severities.includes(opts.failOn)) {
    fail(`--fail-on debe ser una de ${severities.join(', ')}, recibido: ${opts.failOn}`);
  }
  if (!severities.slice(1).includes(opts.riskFloor)) {
    fail(`--risk-floor debe ser una de low, medium, high, critical, recibido: ${opts.riskFloor}`);
  }

  return opts;
}

function fail(msg, code = 1) {
  process.stderr.write(`Error: ${msg}\n`);
  process.exit(code);
}

// ---------------------------------------------------------------------------
// Alcance: derivar la lista de archivos desde Git (y opcionalmente OpenSpec)
// ---------------------------------------------------------------------------

// Extensiones/paths que nunca aportan valor a una auditoría de seguridad y
// solo inflan el prompt — se excluyen del alcance aunque aparezcan en el diff.
const DEFAULT_IGNORE_PATTERNS = [
  /(^|\/)package-lock\.json$/,
  /(^|\/)yarn\.lock$/,
  /(^|\/)pnpm-lock\.yaml$/,
  /(^|\/)\.gitignore$/,
  /\.(png|jpg|jpeg|gif|svg|ico|webp|woff2?|ttf|eot|mp4|mov)$/i,
  /(^|\/)dist\//,
  /(^|\/)build\//,
  /(^|\/)node_modules\//,
  /(^|\/)coverage\//,
];

function runGit(repo, args) {
  const res = spawnSync('git', args, { cwd: repo, encoding: 'utf8' });
  if (res.error) fail(`no se pudo ejecutar git: ${res.error.message}`);
  if (res.status !== 0) {
    fail(`git ${args.join(' ')} falló:\n${res.stderr}`);
  }
  return res.stdout;
}

function isGitRepo(repo) {
  const res = spawnSync('git', ['rev-parse', '--is-inside-work-tree'], { cwd: repo, encoding: 'utf8' });
  return res.status === 0 && res.stdout.trim() === 'true';
}

function getChangedFiles(opts) {
  if (!isGitRepo(opts.repo)) {
    fail(`${opts.repo} no es un repositorio Git. --diff/--diff-range/--staged requieren Git; para auditar sin Git use el flujo de auditoría completa (SKILL.md), no este wrapper.`);
  }

  let diffArgs;
  let baseRef = null;
  let headRef = null;

  if (opts.staged) {
    diffArgs = ['diff', '--cached', '--name-only', '--diff-filter=ACMR'];
    baseRef = 'INDEX';
    headRef = 'staged';
  } else if (opts.diffRange) {
    const [a, b] = opts.diffRange.split('..');
    if (!a || !b) fail(`--diff-range debe tener la forma "a..b", recibido: ${opts.diffRange}`);
    diffArgs = ['diff', '--name-only', '--diff-filter=ACMR', `${a}..${b}`];
    baseRef = a;
    headRef = b;
  } else {
    diffArgs = ['diff', '--name-only', '--diff-filter=ACMR', opts.diffBase];
    baseRef = opts.diffBase;
    headRef = 'working-tree';
  }

  const out = runGit(opts.repo, diffArgs);
  let files = out.split('\n').map((l) => l.trim()).filter(Boolean);

  const extraPatterns = opts.extraIgnore.map((p) => globToRegExp(p));
  const allIgnore = [...DEFAULT_IGNORE_PATTERNS, ...extraPatterns];
  files = files.filter((f) => !allIgnore.some((re) => re.test(f)));

  return { files, baseRef, headRef };
}

// Conversión mínima de un glob simple (*, **, ?) a RegExp — suficiente para
// --extra-ignore, no pretende cubrir la sintaxis completa de .gitignore.
function globToRegExp(glob) {
  const escaped = glob
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '\u0000')
    .replace(/\*/g, '[^/]*')
    .replace(/\u0000/g, '.*')
    .replace(/\?/g, '.');
  return new RegExp(escaped);
}

function resolveOpenSpecContext(opts) {
  if (!opts.openspec) return null;

  let changeDir = path.isAbsolute(opts.openspec)
    ? opts.openspec
    : path.resolve(opts.repo, opts.openspec);

  if (!fs.existsSync(changeDir)) {
    const alt = path.resolve(opts.repo, 'openspec', 'changes', opts.openspec);
    if (fs.existsSync(alt)) {
      changeDir = alt;
    } else {
      fail(`No se encontró la carpeta de cambio de OpenSpec: ${opts.openspec} (probado también en ${alt})`);
    }
  }

  const readIfExists = (name) => {
    const p = path.join(changeDir, name);
    return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null;
  };

  return {
    changeDir,
    changeName: path.basename(changeDir),
    proposal: readIfExists('proposal.md'),
    design: readIfExists('design.md'),
    tasks: readIfExists('tasks.md'),
  };
}

// ---------------------------------------------------------------------------
// Preparar salida y prompt
// ---------------------------------------------------------------------------

function deriveRepoName(opts) {
  if (opts.repoName) return opts.repoName;
  const res = spawnSync('git', ['remote', 'get-url', 'origin'], { cwd: opts.repo, encoding: 'utf8' });
  if (res.status === 0 && res.stdout.trim()) {
    const url = res.stdout.trim();
    const m = url.match(/([^/:]+?)(\.git)?$/);
    if (m) return m[1];
  }
  return path.basename(opts.repo);
}

function nowStamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function buildScope(opts, changedFiles, baseRef, headRef, openspecCtx) {
  return {
    generated_at: new Date().toISOString(),
    mode: 'diff',
    repo: opts.repo,
    repo_name: deriveRepoName(opts),
    base_ref: baseRef,
    head_ref: headRef,
    pattern_scope: opts.patternScope || 'default',
    risk_floor: opts.riskFloor,
    files: changedFiles,
    openspec_change: openspecCtx ? openspecCtx.changeName : null,
  };
}

function buildSystemPromptAddendum(scope, openspecCtx) {
  const fileList = scope.files.map((f) => `- ${f}`).join('\n') || '(ningún archivo en el alcance)';

  let openspecBlock = '';
  if (openspecCtx) {
    openspecBlock = `
## Contexto de OpenSpec: cambio "${openspecCtx.changeName}"

Este diff corresponde a un cambio de OpenSpec. Use lo siguiente únicamente como
contexto de INTENCIÓN (qué se pretendía cambiar y por qué) para priorizar el
registro de amenazas — nunca como afirmación de que el código ya cumple lo
que el proposal dice. El registro de amenazas y los hallazgos deben basarse
en lo que el código en el alcance realmente hace.

### proposal.md
${openspecCtx.proposal || '(no encontrado)'}

### design.md
${openspecCtx.design || '(no encontrado)'}
`;
  }

  return `
# Modo diff — invocación acotada de risk-led-security-audit

Está corriendo en **modo diff**, no en modo de auditoría completa ni en modo
de guía. Esto cambia el alcance, no el rigor: los Principios fundamentales,
las reglas de \`confirmed\`/\`needs_validation\`, el aislamiento de escritura de
reference/write-isolation.md, y el requisito de que el verificador nunca sea el cazador
siguen aplicando exactamente igual que en una auditoría completa.

## Alcance de esta corrida

Referencia base: \`${scope.base_ref}\`
Referencia de cabeza: \`${scope.head_ref}\`
Scope cross-repo: \`${scope.pattern_scope}\`
Piso de riesgo: \`${scope.risk_floor}\`

Archivos cambiados en este diff (esta es la superficie que origina el
modelado de amenazas — puede leer cualquier otro archivo del repo como
contexto necesario para entender un actor, un activo o un límite de
confianza, pero cada entrada de \`threat-register.json\` en esta corrida debe
poder trazarse a al menos uno de estos archivos):

${fileList}
${openspecBlock}
## Instrucciones de ejecución

1. Ejecute la Fase 1 (phases/1-threat-model.md) con el alcance de reconocimiento
   limitado a los archivos de arriba y lo que sea necesario leer para
   entender su contexto (imports, llamadores, definiciones de tipos). No
   levante un registro de amenazas del tamaño de una auditoría completa del
   repositorio.
2. Corra las Fases 2–6 normalmente (phases/2-hunting.md, phases/3-verification.md, phases/4-reporting.md),
   con el piso de riesgo configurado arriba.
3. Escriba todos los artefactos (\`architecture.md\`, \`threat-register.json\`,
   \`findings.json\`, \`REPORT.md\`, y los demás definidos en
   phases/4-reporting.md) en el directorio de salida que se le indique
   por variable de entorno \`AUDIT_OUTPUT_DIR\`, no en otro lugar.
4. Antes de terminar, valide \`findings.json\` corriendo:
   \`node ${path.join(SKILL_DIR, 'validators', 'validate-findings.cjs')} <AUDIT_OUTPUT_DIR>/findings.json <AUDIT_OUTPUT_DIR>/threat-register.json\`
   y valide el registro de amenazas corriendo:
   \`node ${path.join(SKILL_DIR, 'validators', 'validate-threat-register.cjs')} <AUDIT_OUTPUT_DIR>/threat-register.json <AUDIT_OUTPUT_DIR>/findings.json --final\`
   Si alguna validación falla, corrija el archivo y vuelva a validar antes de
   declarar la corrida terminada.
5. Si el diff es tan chico que no hay ningún límite de confianza ni actor
   nuevo involucrado (por ejemplo, un cambio de solo comentarios o de
   formato), escriba igual \`findings.json\` como un arreglo vacío \`[]\` y un
   \`REPORT.md\` breve que lo declare explícitamente — no invente hallazgos
   para justificar la corrida.
`;
}

// ---------------------------------------------------------------------------
// Invocar claude -p
// ---------------------------------------------------------------------------

function invokeClaude(opts, scope, systemPromptAddendum) {
  const skillMdPath = path.join(SKILL_DIR, 'SKILL.md');
  if (!fs.existsSync(skillMdPath)) {
    fail(`No se encontró SKILL.md en ${SKILL_DIR}. Corra este script desde dentro de la carpeta de la habilidad, o revise su instalación.`);
  }

  const basePrompt = `Cargue y siga la habilidad de auditoría de seguridad en ${SKILL_DIR} ` +
    `(empiece por SKILL.md) contra el repositorio en ${opts.repo}, en modo diff ` +
    `según se detalla en las instrucciones adjuntas. El directorio de salida es ` +
    `${scope.__outputDir}.`;

  const args = [
    '-p', basePrompt,
    '--append-system-prompt', systemPromptAddendum,
    '--output-format', 'json',
    '--add-dir', SKILL_DIR,
    '--add-dir', opts.repo,
  ];

  if (opts.maxTurns) args.push('--max-turns', String(opts.maxTurns));
  if (opts.maxBudgetUsd) args.push('--max-budget-usd', String(opts.maxBudgetUsd));
  if (opts.model) args.push('--model', opts.model);

  // Permisos: lectura amplia del objetivo y de la habilidad, ejecución acotada
  // a lo que el sandbox de la habilidad necesita, y escritura únicamente
  // dentro del directorio de salida de esta corrida y de su scratch. No se
  // otorga bypass total de permisos — el punto de este wrapper es correr sin
  // una persona apretando "sí" en cada paso, no correr sin ningún límite.
  const allowedTools = [
    'Read',
    'Grep',
    'Glob',
    `Write(${scope.__outputDir}/**)`,
    `Bash(node ${path.join(SKILL_DIR, 'validators', 'validate-findings.cjs')}:*)`,
    `Bash(node ${path.join(SKILL_DIR, 'validators', 'validate-cross-repo.cjs')}:*)`,
    `Bash(node ${path.join(SKILL_DIR, 'validators', 'validate-threat-register.cjs')}:*)`,
  ];
  args.push('--allowedTools', allowedTools.join(','));
  args.push('--permission-mode', 'acceptEdits');
  args.push('--permission-prompts', 'none');

  return { bin: opts.claudeBin, args };
}

// ---------------------------------------------------------------------------
// Leer findings.json y decidir exit code
// ---------------------------------------------------------------------------

const SEVERITY_ORDER = ['informational', 'low', 'medium', 'high', 'critical'];

function severityAtLeast(a, b) {
  return SEVERITY_ORDER.indexOf(a) >= SEVERITY_ORDER.indexOf(b);
}

function evaluateFindings(outputDir, opts) {
  const findingsPath = path.join(outputDir, 'findings.json');
  if (!fs.existsSync(findingsPath)) {
    return { ok: false, reason: `no se generó ${findingsPath}`, findings: [] };
  }

  let findings;
  try {
    findings = JSON.parse(fs.readFileSync(findingsPath, 'utf8'));
  } catch (e) {
    return { ok: false, reason: `findings.json no es JSON válido: ${e.message}`, findings: [] };
  }

  let validateFindings;
  try {
    ({ validateFindings } = require(path.join(SKILL_DIR, 'validators', 'validate-findings.cjs')));
  } catch (e) {
    return { ok: false, reason: `no se pudo cargar validate-findings.cjs: ${e.message}`, findings };
  }

  // validate-findings.cjs espera un Set de threat_id (no el arreglo crudo del
  // registro) como tercer argumento — replicamos aquí la misma extracción que
  // hace su propio loadThreatIds() internamente, ya que esa función no forma
  // parte de su superficie exportada.
  const threatRegisterPath = path.join(outputDir, 'threat-register.json');
  let threatIds = null;
  let register = null;
  if (fs.existsSync(threatRegisterPath)) {
    try {
      register = JSON.parse(fs.readFileSync(threatRegisterPath, 'utf8'));
      if (!Array.isArray(register)) {
        return { ok: false, reason: 'threat-register.json debe ser un arreglo de nivel superior', findings };
      }
      threatIds = new Set(register.map((t) => t.threat_id).filter((id) => typeof id === 'string'));
    } catch (e) {
      return { ok: false, reason: `threat-register.json no es JSON válido: ${e.message}`, findings };
    }
  }

  const schemaPath = path.join(SKILL_DIR, 'schemas', 'findings.schema.json');
  const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
  const errors = validateFindings(findings, schema, threatIds);

  if (register) {
    const { validateThreatRegister } = require(path.join(SKILL_DIR, 'validators', 'validate-threat-register.cjs'));
    const registerSchema = JSON.parse(fs.readFileSync(path.join(SKILL_DIR, 'schemas', 'threat-register.schema.json'), 'utf8'));
    for (const e of validateThreatRegister(register, registerSchema, { findings, final: true })) {
      errors.push(`threat-register.json: ${e}`);
    }
  }

  const confirmed = findings.filter((f) => f.verdict === 'confirmed');
  const needsValidation = findings.filter((f) => f.verdict === 'needs_validation');
  const blocking = confirmed.filter((f) => severityAtLeast(f.severity?.overall_severity, opts.failOn));

  return {
    ok: errors.length === 0,
    reason: errors.length === 0 ? null : `los artefactos no pasaron la validación: ${errors.join('; ')}`,
    findings,
    confirmed,
    needsValidation,
    blocking,
  };
}

function printSummary(evalResult, opts, outputDir) {
  process.stdout.write('\n=== Resumen de audit-diff ===\n');
  process.stdout.write(`Directorio de salida: ${outputDir}\n`);
  if (!evalResult.ok) {
    process.stdout.write(`Estado: ERROR — ${evalResult.reason}\n`);
    return;
  }
  process.stdout.write(`Hallazgos confirmed: ${evalResult.confirmed.length}\n`);
  process.stdout.write(`Hallazgos needs_validation: ${evalResult.needsValidation.length}\n`);
  if (evalResult.confirmed.length) {
    for (const f of evalResult.confirmed) {
      process.stdout.write(`  - [${f.severity?.overall_severity}] ${f.title}\n`);
    }
  }
  if (opts.mode === 'gate') {
    process.stdout.write(`Modo: gate (falla si hay confirmed >= ${opts.failOn})\n`);
    process.stdout.write(`Hallazgos que bloquean: ${evalResult.blocking.length}\n`);
  } else {
    process.stdout.write('Modo: informative (nunca falla el proceso por hallazgos)\n');
  }
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

function main() {
  const opts = parseArgs(process.argv.slice(2));

  const { files: changedFiles, baseRef, headRef } = getChangedFiles(opts);
  const openspecCtx = resolveOpenSpecContext(opts);

  const repoName = deriveRepoName(opts);
  const outputDir = opts.output || path.join(
    process.env.HOME || '/root',
    'risk-led-security-audit',
    repoName,
    `diff-run-${nowStamp()}`
  );

  const scope = buildScope(opts, changedFiles, baseRef, headRef, openspecCtx);
  scope.__outputDir = outputDir;

  if (changedFiles.length === 0) {
    process.stdout.write('Alcance vacío: no hay archivos cambiados según el diff solicitado. Nada que auditar.\n');
    process.exit(0);
  }

  fs.mkdirSync(outputDir, { recursive: true });
  const { __outputDir, ...scopeToWrite } = scope;
  fs.writeFileSync(path.join(outputDir, 'scope.json'), JSON.stringify(scopeToWrite, null, 2));

  const systemPromptAddendum = buildSystemPromptAddendum(scope, openspecCtx);
  fs.writeFileSync(path.join(outputDir, 'diff-mode-prompt.md'), systemPromptAddendum);

  const invocation = invokeClaude(opts, scope, systemPromptAddendum);

  if (opts.dryRun) {
    process.stdout.write('--- DRY RUN: no se invoca claude ---\n');
    process.stdout.write(`Alcance (${changedFiles.length} archivos):\n${changedFiles.map((f) => `  - ${f}`).join('\n')}\n\n`);
    process.stdout.write(`Directorio de salida: ${outputDir}\n`);
    process.stdout.write(`scope.json y diff-mode-prompt.md escritos en ese directorio.\n\n`);
    process.stdout.write(`Comando que se ejecutaría:\n${invocation.bin} ${invocation.args.map((a) => (a.includes(' ') ? JSON.stringify(a) : a)).join(' ')}\n`);
    process.exit(0);
  }

  if (!opts.allowWrite) {
    fail('Este wrapper necesita darle al agente permiso de escritura sobre el directorio de salida para que pueda producir findings.json. Vuelva a correr con --allow-write para confirmarlo explícitamente (o use --dry-run para revisar el alcance y el comando sin ejecutar nada).');
  }

  process.stdout.write(`Auditando ${changedFiles.length} archivo(s) cambiado(s) contra ${opts.repo}...\n`);
  process.stdout.write(`Directorio de salida: ${outputDir}\n`);

  const res = spawnSync(invocation.bin, invocation.args, {
    cwd: opts.repo,
    stdio: ['ignore', 'inherit', 'inherit'],
    env: { ...process.env, AUDIT_OUTPUT_DIR: outputDir },
  });

  if (res.error) {
    fail(`no se pudo invocar "${invocation.bin}": ${res.error.message}. ¿Está en PATH? Pruebe --claude-bin <ruta>.`);
  }

  const evalResult = evaluateFindings(outputDir, opts);
  printSummary(evalResult, opts, outputDir);

  if (!evalResult.ok) {
    process.exit(2);
  }
  if (opts.mode === 'gate' && evalResult.blocking.length > 0) {
    process.exit(1);
  }
  process.exit(0);
}

main();
