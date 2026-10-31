'use strict';

const fs = require('fs');
const path = require('path');
const { input, inventory, normalizedHash, safeResolve, safeOutputPath } = require('../../src/index.js');

const PROFILES = new Set(['generic', 'qbr', 'vciso', 'cyber-insurance', 'nis2', 'iso27001', 'soc2', 'dora']);

function setOutput(name, value) {
  if (!process.env.GITHUB_OUTPUT) return;
  fs.appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${String(value).replace(/\r?\n/g, ' ')}\n`, 'utf8');
}
function appendSummary(value) {
  if (!process.env.GITHUB_STEP_SUMMARY) return;
  fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${value}\n`, 'utf8');
}
function evidenceObservation(key, label, observed, detail) { return { key, label, state: observed ? 'observed' : 'not_observed', detail }; }

function buildPack(root, profile, clientId) {
  const estate = inventory(root);
  const deps = estate.findings.filter((finding) => finding.category === 'action_dependency');
  const immutable = deps.filter((finding) => finding.immutable_ref);
  const mutable = deps.filter((finding) => !finding.immutable_ref);
  const attestations = deps.filter((finding) => /^actions\/attest-(?:build-provenance|sbom)@/i.test(finding.detail));
  const observations = [
    evidenceObservation('machine_estate', 'Machine or machine-consumed surfaces', estate.machine_count > 0, `${estate.machine_count} observation(s) across ${estate.category_count} categories.`),
    evidenceObservation('machine_identity', 'ECZ-ID / Resolver identity reference', estate.identity_references.length > 0, `${estate.identity_references.length} reference(s) observed.`),
    evidenceObservation('workflow_lock', 'GitHub Actions workflow lockfile', estate.signals.actions_lock, estate.signals.actions_lock ? 'actions.lock observed.' : 'No actions.lock observed in the inspected path.'),
    evidenceObservation('oidc', 'OIDC workflow declaration', estate.signals.oidc, estate.signals.oidc ? 'id-token: write observed in a workflow.' : 'No id-token: write declaration observed.'),
    evidenceObservation('immutable_action_refs', 'Immutable full-SHA Action references', immutable.length > 0, `${immutable.length} immutable full-SHA Action reference(s) observed.`),
    evidenceObservation('mutable_action_refs', 'Mutable/non-full-SHA Action references', mutable.length > 0, `${mutable.length} mutable/non-full-SHA Action reference(s) observed.`),
    evidenceObservation('artifact_attestation', 'GitHub artifact attestation Action', attestations.length > 0, `${attestations.length} attestation Action reference(s) observed.`),
    evidenceObservation('self_hosted_runner', 'Self-hosted runner reference', estate.signals.self_hosted_runner, estate.signals.self_hosted_runner ? 'A self-hosted runner reference was observed.' : 'No self-hosted runner reference observed.'),
    evidenceObservation('pull_request_target', 'pull_request_target trigger', estate.signals.pull_request_target, estate.signals.pull_request_target ? 'pull_request_target observed.' : 'No pull_request_target trigger observed.'),
    evidenceObservation('write_all', 'write-all workflow permission', estate.signals.write_all, estate.signals.write_all ? 'permissions: write-all observed.' : 'No permissions: write-all declaration observed.')
  ];
  const evidencePayload = { schema_version: '1.0.0', client_id: clientId || null, profile, machine_categories: estate.categories, identity_references: estate.identity_references, observations, dependencies: deps.map((finding) => ({ file: finding.file, ref: finding.detail, immutable_ref: Boolean(finding.immutable_ref) })), findings: estate.findings };
  return { schema_version: '1.0.0', generated_at: new Date().toISOString(), result_state: 'EVIDENCE_PACK_CREATED', client_id: clientId || null, profile, evidence_hash: normalizedHash(evidencePayload), evidence_scope: 'Observable technical evidence from the inspected GitHub repository/worktree only.', observations, machine_categories: estate.categories, identity_references: estate.identity_references, machine_count: estate.machine_count, findings: estate.findings, claims_boundary: 'Evidence aid only. Observed/not observed does not mean compliant/non-compliant, secure/insecure, certified, approved, audited, or endorsed.' };
}

function nextAction(pack) {
  const managedProfiles = new Set(['qbr', 'vciso', 'cyber-insurance', 'nis2', 'iso27001', 'soc2', 'dora']);
  if (!managedProfiles.has(pack.profile) || pack.machine_count === 0) return '';
  return 'https://msp.ecocitizenz.com/apply?plan=core&utm_source=github&utm_medium=action&utm_campaign=msp-evidence-pack&utm_content=managed-evidence';
}
function renderMarkdown(pack) {
  const rows = pack.observations.map((item) => `| ${item.label} | ${item.state} | ${item.detail.replace(/\|/g, '\\|')} |`).join('\n');
  const categories = pack.machine_categories.length ? pack.machine_categories.join(', ') : 'none observed';
  const next = pack.next_action_url ? `\n## One next step\n\nIf this evidence needs to be retained, repeated and aggregated across client repositories, review **Machine Trust Core**:\n\n${pack.next_action_url}\n` : '';
  return `# ECZ-ID MSP Evidence & QBR Pack\n\n**Profile:** ${pack.profile}  \n**Client ID:** ${pack.client_id || 'not supplied'}  \n**Evidence hash:** \`${pack.evidence_hash}\`  \n**Machine categories:** ${categories}\n\n## Technical evidence observations\n\n| Evidence item | State | Detail |\n|---|---|---|\n${rows}\n\n## Interpretation boundary\n\n${pack.claims_boundary}\n\nThis pack is intended to reduce manual evidence collection for MSP QBR, vCISO, insurance and regulatory-review workflows. Framework-specific profiles are organisational aids only; they do not assert that a framework control is satisfied.${next}`;
}

function run(options = {}) {
  const workspace = path.resolve(options.workspace || process.env.GITHUB_WORKSPACE || process.cwd());
  const root = safeResolve(workspace, options.path || input('path', '.'));
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) throw new Error('Inspection path does not exist or is not a directory.');
  const profile = String(options.profile || input('profile', 'qbr')).toLowerCase();
  if (!PROFILES.has(profile)) throw new Error(`Unsupported profile: ${profile}`);
  const clientId = options.clientId != null ? options.clientId : input('client-id', '');
  const jsonPath = safeOutputPath(workspace, options.outputJson || input('output-json', 'eczid-msp-evidence-pack.json'));
  const markdownPath = safeOutputPath(workspace, options.outputMarkdown || input('output-markdown', 'eczid-msp-evidence-pack.md'));
  const pack = buildPack(root, profile, clientId); pack.next_action_url = nextAction(pack);
  const markdown = renderMarkdown(pack);
  fs.mkdirSync(path.dirname(jsonPath), { recursive: true }); fs.mkdirSync(path.dirname(markdownPath), { recursive: true });
  fs.writeFileSync(jsonPath, `${JSON.stringify(pack, null, 2)}\n`, 'utf8'); fs.writeFileSync(markdownPath, `${markdown}\n`, 'utf8');
  return { pack, jsonPath, markdownPath, markdown };
}

function main() {
  const failOn = input('fail-on', 'invalid').toLowerCase();
  try {
    const { pack, jsonPath, markdownPath, markdown } = run();
    const observed = pack.observations.filter((item) => item.state === 'observed').length; const notObserved = pack.observations.length - observed;
    setOutput('result-state', pack.result_state); setOutput('evidence-hash', pack.evidence_hash); setOutput('observed-count', observed); setOutput('not-observed-count', notObserved);
    setOutput('json-path', path.relative(process.env.GITHUB_WORKSPACE || process.cwd(), jsonPath).split(path.sep).join('/')); setOutput('markdown-path', path.relative(process.env.GITHUB_WORKSPACE || process.cwd(), markdownPath).split(path.sep).join('/')); setOutput('next-action-url', pack.next_action_url || '');
    appendSummary(markdown); console.log(`ECZ-ID MSP Evidence & QBR Pack: created ${pack.profile} pack ${pack.evidence_hash}.`);
  } catch (error) {
    setOutput('result-state', 'INVALID_INPUT'); setOutput('evidence-hash', ''); setOutput('observed-count', '0'); setOutput('not-observed-count', '0'); setOutput('json-path', ''); setOutput('markdown-path', ''); setOutput('next-action-url', '');
    appendSummary(`## ECZ-ID MSP Evidence & QBR Pack\n\n**Result:** \`INVALID_INPUT\`\n\n${error.message}\n\nNo compliance, audit or security verdict was produced.`); console.error(error.message); if (failOn !== 'never') process.exitCode = 2;
  }
}

if (require.main === module) main();
module.exports = { buildPack, nextAction, renderMarkdown, run };
