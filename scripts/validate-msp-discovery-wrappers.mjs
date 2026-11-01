#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const ENGINE_SHA = 'fedb5cb7633e7cf74c952291a7fbe302e5333af6';
const ENGINE = 'EcoCitizenz-Ltd/eczid-msp-machine-trust-toolkit';
const releaseRoot = join(root, 'release', 'discovery-wrappers');

const expected = Object.freeze({
  'eczid-msp-ai-agent-estate': {
    target: `${ENGINE}/actions/ai-agent-estate@${ENGINE_SHA}`,
    inputs: ['path', 'client-id', 'output', 'fail-on'],
    outputs: ['result-state', 'surface-count', 'identity-reference-count', 'report-path', 'next-action-url'],
  },
  'eczid-msp-machine-estate-inventory': {
    target: `${ENGINE}@${ENGINE_SHA}`,
    inputs: ['path', 'client-id', 'output', 'fail-on'],
    outputs: ['result-state', 'machine-count', 'category-count', 'identity-reference-count', 'baseline-hash', 'report-path', 'next-action-url'],
  },
  'eczid-msp-evidence-qbr-pack': {
    target: `${ENGINE}/actions/evidence-qbr-pack@${ENGINE_SHA}`,
    inputs: ['path', 'client-id', 'profile', 'output-json', 'output-markdown', 'fail-on'],
    outputs: ['result-state', 'evidence-hash', 'observed-count', 'not-observed-count', 'json-path', 'markdown-path', 'next-action-url'],
  },
  'eczid-msp-standard-drift': {
    target: `${ENGINE}/actions/standard-drift@${ENGINE_SHA}`,
    inputs: ['path', 'client-id', 'baseline', 'output', 'mode', 'fail-on'],
    outputs: ['result-state', 'current-hash', 'expected-hash', 'changed-field-count', 'report-path', 'next-action-url'],
  },
});

function fail(message) {
  throw new Error(message);
}

function files(dir) {
  return readdirSync(dir).sort().filter((name) => statSync(join(dir, name)).isFile());
}

function mustContain(text, token, label) {
  if (!text.includes(token)) fail(`${label}: missing required token: ${token}`);
}

execFileSync(process.execPath, [join(root, 'scripts', 'build-msp-discovery-wrappers.mjs')], {
  cwd: root,
  stdio: 'inherit',
});

if (!existsSync(releaseRoot)) fail('release/discovery-wrappers was not generated.');
const dirs = readdirSync(releaseRoot).sort().filter((name) => statSync(join(releaseRoot, name)).isDirectory());
const expectedDirs = Object.keys(expected).sort();
if (JSON.stringify(dirs) !== JSON.stringify(expectedDirs)) {
  fail(`wrapper directory set mismatch; expected=${expectedDirs.join(',')} actual=${dirs.join(',')}`);
}

for (const [slug, spec] of Object.entries(expected)) {
  const dir = join(releaseRoot, slug);
  const actualFiles = files(dir);
  const expectedFiles = ['ENGINE_SHA', 'README.md', 'action.yml'];
  if (JSON.stringify(actualFiles) !== JSON.stringify(expectedFiles)) {
    fail(`${slug}: public wrapper pack shape mismatch; expected=${expectedFiles.join(',')} actual=${actualFiles.join(',')}`);
  }

  const engineSha = readFileSync(join(dir, 'ENGINE_SHA'), 'utf8').trim();
  if (engineSha !== ENGINE_SHA) fail(`${slug}: ENGINE_SHA mismatch.`);
  if (!/^[0-9a-f]{40}$/.test(engineSha)) fail(`${slug}: engine pin is not a full commit SHA.`);

  const action = readFileSync(join(dir, 'action.yml'), 'utf8');
  const readme = readFileSync(join(dir, 'README.md'), 'utf8');
  mustContain(action, 'using: composite', slug);
  mustContain(action, spec.target, slug);
  mustContain(action, 'id: delegate', slug);
  if (/@(?:main|master|v\d+)\b/i.test(action)) fail(`${slug}: mutable engine reference found in wrapper action.yml.`);
  if ((action.match(/\n\s*uses:/g) ?? []).length !== 1) fail(`${slug}: wrapper must delegate through exactly one uses step.`);

  for (const input of spec.inputs) {
    mustContain(action, `  ${input}:`, `${slug} input`);
    mustContain(action, `${input}: \${{ inputs.${input} }}`, `${slug} delegate input`);
  }
  for (const output of spec.outputs) {
    mustContain(action, `  ${output}:`, `${slug} output`);
    mustContain(action, `value: \${{ steps.delegate.outputs.${output} }}`, `${slug} delegate output`);
  }

  for (const phrase of [
    'No repository source upload to ECZ-ID.',
    'No hidden telemetry.',
    'Missing ECZ-ID identity is neutral',
    'No pay-to-pass.',
    'Local MSP/customer policy decides',
    `Delegates to \`${spec.target}\``,
  ]) mustContain(readme, phrase, `${slug} README`);

  if (/£|\$\d|monthly|yearly|per month|per year/i.test(readme)) {
    fail(`${slug}: mutable commercial price/cadence copy escaped into public wrapper README.`);
  }
  for (const forbidden of ['BEGIN PRIVATE KEY', 'node_modules/', '.map', '.ts', 'ECZID_DEV_SEAM']) {
    if (action.includes(forbidden) || readme.includes(forbidden)) fail(`${slug}: forbidden material detected: ${forbidden}`);
  }
}

console.log(JSON.stringify({
  ok: true,
  engine_sha: ENGINE_SHA,
  wrapper_count: expectedDirs.length,
  wrappers: expectedDirs,
}));
