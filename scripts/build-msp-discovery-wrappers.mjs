#!/usr/bin/env node
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const ENGINE_SHA = 'fedb5cb7633e7cf74c952291a7fbe302e5333af6';
const ENGINE = 'EcoCitizenz-Ltd/eczid-msp-machine-trust-toolkit';

const wrappers = [
  {
    slug: 'eczid-msp-ai-agent-estate',
    name: 'ECZ-ID MSP AI & Agent Estate',
    description: 'Inventory supported AI-agent, MCP, plugin and workflow authority surfaces in a customer repository and identify one neutral next managed-accountability step.',
    target: 'actions/ai-agent-estate',
    inputs: [
      ['path', 'Repository-relative path to inspect.', false, '.'],
      ['client-id', 'Optional customer identifier recorded locally; never sent to ECZ-ID.', false, ''],
      ['output', 'Repository-relative JSON report path.', false, 'eczid-msp-ai-agent-estate.json'],
      ['fail-on', 'invalid or never. Missing identity never fails the Action.', false, 'invalid'],
    ],
    outputs: [
      ['result-state', 'NO_AI_AGENT_SURFACES, AI_AGENT_ESTATE_OBSERVED, REVIEW_RECOMMENDED, or INVALID_INPUT.'],
      ['surface-count', 'Number of supported AI/agent/MCP/plugin/workflow observations.'],
      ['identity-reference-count', 'Number of ECZ-ID/Resolver references observed.'],
      ['report-path', 'Generated JSON report path.'],
      ['next-action-url', 'One contextual free or managed-accountability next step.'],
    ],
    quick: 'uses: EcoCitizenz-Ltd/eczid-msp-ai-agent-estate@v1',
  },
  {
    slug: 'eczid-msp-machine-estate-inventory',
    name: 'ECZ-ID MSP Machine Estate Inventory',
    description: 'Discover machine actors and machine-consumed surfaces in a customer repository, create a neutral evidence inventory, and identify the next review step.',
    target: '',
    inputs: [
      ['path', 'Repository-relative path to inspect.', false, '.'],
      ['client-id', 'Optional MSP/customer identifier recorded locally; never sent to ECZ-ID.', false, ''],
      ['output', 'Repository-relative JSON report path.', false, 'eczid-msp-machine-estate.json'],
      ['fail-on', 'invalid or never. Missing ECZ-ID identity never fails the run.', false, 'invalid'],
    ],
    outputs: [
      ['result-state', 'NO_MACHINE_SURFACES, MACHINE_ESTATE_OBSERVED, REVIEW_RECOMMENDED, or INVALID_INPUT.'],
      ['machine-count', 'Number of machine or machine-consumed surfaces observed.'],
      ['category-count', 'Number of distinct observed categories.'],
      ['identity-reference-count', 'Number of ECZ-ID or Resolver identity references observed.'],
      ['baseline-hash', 'SHA-256 hash of the normalized inventory payload.'],
      ['report-path', 'Path to the generated JSON report.'],
      ['next-action-url', 'One contextual ECZ-ID next step, or empty when none is warranted.'],
    ],
    quick: 'uses: EcoCitizenz-Ltd/eczid-msp-machine-estate-inventory@v1',
  },
  {
    slug: 'eczid-msp-evidence-qbr-pack',
    name: 'ECZ-ID MSP Evidence & QBR Pack',
    description: 'Turn observable GitHub and machine-estate facts into a deterministic client evidence pack for QBR, vCISO, insurance and regulatory review workflows.',
    target: 'actions/evidence-qbr-pack',
    inputs: [
      ['path', 'Repository-relative path to inspect.', false, '.'],
      ['client-id', 'Optional MSP/customer identifier recorded locally in the pack.', false, ''],
      ['profile', 'generic, qbr, vciso, cyber-insurance, nis2, iso27001, soc2, or dora.', false, 'qbr'],
      ['output-json', 'Repository-relative JSON evidence pack path.', false, 'eczid-msp-evidence-pack.json'],
      ['output-markdown', 'Repository-relative Markdown client summary path.', false, 'eczid-msp-evidence-pack.md'],
      ['fail-on', 'invalid or never.', false, 'invalid'],
    ],
    outputs: [
      ['result-state', 'EVIDENCE_PACK_CREATED or INVALID_INPUT.'],
      ['evidence-hash', 'SHA-256 hash of the normalized technical evidence payload.'],
      ['observed-count', 'Number of evidence observations marked observed.'],
      ['not-observed-count', 'Number of evidence observations marked not_observed.'],
      ['json-path', 'Path to the JSON evidence pack.'],
      ['markdown-path', 'Path to the Markdown client summary.'],
      ['next-action-url', 'Contextual recurring-service next step when a managed-evidence need is indicated.'],
    ],
    quick: 'uses: EcoCitizenz-Ltd/eczid-msp-evidence-qbr-pack@v1',
  },
  {
    slug: 'eczid-msp-standard-drift',
    name: 'ECZ-ID MSP Standard Drift',
    description: "Compare a customer repository's current machine-trust projection with an MSP-approved baseline without making a universal trust or compliance verdict.",
    target: 'actions/standard-drift',
    inputs: [
      ['path', 'Repository-relative path to inspect.', false, '.'],
      ['client-id', 'Optional MSP/customer identifier included in the proposed/current projection.', false, ''],
      ['baseline', 'Repository-relative path to the approved baseline JSON.', false, '.eczid/msp-baseline.json'],
      ['output', 'Repository-relative path for the drift report or proposed baseline.', false, 'eczid-msp-standard-drift.json'],
      ['mode', 'check or propose. Propose emits a baseline proposal but never commits it.', false, 'check'],
      ['fail-on', 'invalid or never. Drift does not fail by default.', false, 'invalid'],
    ],
    outputs: [
      ['result-state', 'NO_CHANGE, CHANGED, BASELINE_PROPOSED, or INVALID_INPUT.'],
      ['current-hash', 'SHA-256 hash of the current normalized projection.'],
      ['expected-hash', 'SHA-256 hash of the approved baseline projection when present.'],
      ['changed-field-count', 'Number of top-level projection fields that differ.'],
      ['report-path', 'Path to the generated drift report or proposed baseline.'],
      ['next-action-url', 'One contextual next step when drift is observed.'],
    ],
    quick: 'uses: EcoCitizenz-Ltd/eczid-msp-standard-drift@v1',
  },
];

function q(value) {
  return JSON.stringify(String(value));
}

function actionYaml(w) {
  const lines = [
    `name: ${q(w.name)}`,
    `description: ${q(w.description)}`,
    'author: EcoCitizenz Ltd',
    'branding:',
    '  icon: shield',
    '  color: green',
    'inputs:',
  ];
  for (const [name, description, required, defaultValue] of w.inputs) {
    lines.push(`  ${name}:`, `    description: ${q(description)}`, `    required: ${required ? 'true' : 'false'}`);
    if (defaultValue !== '') lines.push(`    default: ${q(defaultValue)}`);
  }
  lines.push('outputs:');
  for (const [name, description] of w.outputs) {
    lines.push(`  ${name}:`, `    description: ${q(description)}`, `    value: \${{ steps.delegate.outputs.${name} }}`);
  }
  lines.push('runs:', '  using: composite', '  steps:', '    - id: delegate');
  const suffix = w.target ? `/${w.target}` : '';
  lines.push(`      uses: ${ENGINE}${suffix}@${ENGINE_SHA}`, '      with:');
  for (const [name] of w.inputs) {
    lines.push(`        ${name}: \${{ inputs.${name} }}`);
  }
  return `${lines.join('\n')}\n`;
}

function readme(w) {
  const inputRows = w.inputs.map(([name, description, required, defaultValue]) =>
    `| \`${name}\` | ${required ? 'yes' : 'no'} | ${defaultValue === '' ? 'empty' : `\`${defaultValue}\``} | ${description} |`
  ).join('\n');
  const outputRows = w.outputs.map(([name, description]) => `| \`${name}\` | ${description} |`).join('\n');
  const target = w.target ? `${ENGINE}/${w.target}` : ENGINE;
  return `# ${w.name}\n\n${w.description}\n\nThis is a thin GitHub Marketplace discovery wrapper over the already-tested ECZ-ID MSP engine. It delegates to the immutable engine commit \`${ENGINE_SHA}\`; it does not duplicate the engine or create a second source of truth.\n\n## Quick start\n\n\`\`\`yaml\n- ${w.quick}\n\`\`\`\n\n## Inputs\n\n| Input | Required | Default | Meaning |\n|---|---:|---|---|\n${inputRows}\n\n## Outputs\n\n| Output | Meaning |\n|---|---|\n${outputRows}\n\n## Trust boundary\n\n- Runs in the caller's GitHub Actions workspace.\n- No repository source upload to ECZ-ID.\n- No hidden telemetry.\n- Missing ECZ-ID identity is neutral and never means unsafe, non-compliant or untrusted.\n- No universal safety, trust, certification or compliance verdict.\n- No pay-to-pass.\n- Local MSP/customer policy decides what observed evidence means.\n\n## Engine provenance\n\nDelegates to \`${target}@${ENGINE_SHA}\`. Marketplace wrapper releases must only advance this pin after the shared engine's own cross-platform tests are green.\n\n## Why this wrapper exists\n\nGitHub Marketplace discovery works at the repository root. The underlying MSP engine intentionally keeps related Actions together; this wrapper makes one proven capability independently discoverable without copying implementation or creating maintenance drift.\n`;
}

const outRoot = join(root, 'release', 'discovery-wrappers');
rmSync(outRoot, { recursive: true, force: true });
mkdirSync(outRoot, { recursive: true });
for (const wrapper of wrappers) {
  const dir = join(outRoot, wrapper.slug);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'action.yml'), actionYaml(wrapper));
  writeFileSync(join(dir, 'README.md'), readme(wrapper));
  writeFileSync(join(dir, 'ENGINE_SHA'), `${ENGINE_SHA}\n`);
  console.log(`[msp-discovery-wrapper] ${wrapper.slug} -> ${wrapper.target || '<root>'}@${ENGINE_SHA}`);
}
