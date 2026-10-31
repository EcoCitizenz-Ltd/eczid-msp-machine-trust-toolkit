'use strict';

const fs = require('fs');
const path = require('path');
const { inventory, normalizedHash, safeResolve, safeOutputPath } = require('../../src/index.js');

function input(name, fallback = '') {
  const value = process.env[`INPUT_${name.toUpperCase().replace(/-/g, '_')}`];
  return value == null || value === '' ? fallback : value;
}

function setOutput(name, value) {
  if (!process.env.GITHUB_OUTPUT) return;
  fs.appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${String(value).replace(/\r?\n/g, ' ')}\n`, 'utf8');
}

function appendSummary(value) {
  if (!process.env.GITHUB_STEP_SUMMARY) return;
  fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${value}\n`, 'utf8');
}

function projectionFor(root, clientId) {
  const observed = inventory(root);
  const deps = observed.findings
    .filter((finding) => finding.category === 'action_dependency')
    .map((finding) => ({ file: finding.file, ref: finding.detail, immutable_ref: Boolean(finding.immutable_ref) }));
  return {
    schema_version: '1.0.0',
    client_id: clientId || null,
    categories: observed.categories,
    identity_references: observed.identity_references,
    signals: observed.signals,
    action_dependencies: deps,
    findings: observed.findings
  };
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.keys(value).sort().reduce((acc, key) => {
      acc[key] = canonical(value[key]);
      return acc;
    }, {});
  }
  return value;
}

function changedFields(expected, current) {
  const keys = [...new Set([...Object.keys(expected || {}), ...Object.keys(current || {})])].sort();
  return keys.filter((key) => JSON.stringify(canonical(expected?.[key])) !== JSON.stringify(canonical(current?.[key])));
}

function normalizeBaselinePayload(raw) {
  if (raw && raw.projection && typeof raw.projection === 'object') return raw.projection;
  if (raw && raw.baseline_projection && typeof raw.baseline_projection === 'object') return raw.baseline_projection;
  if (raw && raw.schema_version && Array.isArray(raw.categories)) return raw;
  throw new Error('Baseline JSON does not contain a supported projection.');
}

function nextAction(state) {
  if (state !== 'CHANGED') return '';
  return 'https://msp.ecocitizenz.com/apply?plan=core&utm_source=github&utm_medium=action&utm_campaign=msp-standard-drift&utm_content=change-observed';
}

function summary(report) {
  const changes = report.changed_fields.length ? report.changed_fields.map((field) => `- ${field}`).join('\n') : '- None';
  const next = report.next_action_url ? `\n### One next step\n\nDrift was observed. If this client needs retained history and continuous multi-repository monitoring, review **Machine Trust Core**.\n\n${report.next_action_url}\n` : '';
  return `## ECZ-ID MSP Standard Drift\n\n**Result:** \`${report.result_state}\`  \n**Current hash:** \`${report.current_hash}\`  \n**Expected hash:** ${report.expected_hash ? `\`${report.expected_hash}\`` : 'not supplied'}\n\n### Changed projection fields\n\n${changes}\n\nThis comparison reports change against an MSP-selected baseline. A change is not automatically unsafe or non-compliant, and no universal trust verdict is produced.${next}`;
}

function run(options = {}) {
  const workspace = path.resolve(options.workspace || process.env.GITHUB_WORKSPACE || process.cwd());
  const root = safeResolve(workspace, options.path || input('path', '.'));
  const baselinePath = safeResolve(workspace, options.baseline || input('baseline', '.eczid/msp-baseline.json'));
  const outputPath = safeOutputPath(workspace, options.output || input('output', 'eczid-msp-standard-drift.json'));
  const clientId = options.clientId != null ? options.clientId : input('client-id', '');
  const mode = String(options.mode || input('mode', 'check')).toLowerCase();
  if (!['check', 'propose'].includes(mode)) throw new Error(`Unsupported mode: ${mode}`);
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) throw new Error('Inspection path does not exist or is not a directory.');

  const current = projectionFor(root, clientId);
  const currentHash = normalizedHash(current);

  if (mode === 'propose' || !fs.existsSync(baselinePath)) {
    const proposal = {
      schema_version: '1.0.0',
      result_state: 'BASELINE_PROPOSED',
      generated_at: new Date().toISOString(),
      baseline_projection: current,
      baseline_hash: currentHash,
      requested_baseline_path: path.relative(workspace, baselinePath).split(path.sep).join('/'),
      note: 'This Action only proposes a baseline file. It does not commit, approve, or enforce the proposal.'
    };
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, `${JSON.stringify(proposal, null, 2)}\n`, 'utf8');
    return { report: { ...proposal, current_hash: currentHash, expected_hash: '', changed_fields: [], next_action_url: '' }, outputPath };
  }

  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
  } catch (error) {
    throw new Error(`Unable to parse baseline JSON: ${error.message}`);
  }
  const expected = normalizeBaselinePayload(parsed);
  const expectedHash = normalizedHash(expected);
  const fields = changedFields(expected, current);
  const state = fields.length ? 'CHANGED' : 'NO_CHANGE';
  const report = {
    schema_version: '1.0.0',
    generated_at: new Date().toISOString(),
    result_state: state,
    client_id: clientId || null,
    current_hash: currentHash,
    expected_hash: expectedHash,
    changed_fields: fields,
    changed_field_count: fields.length,
    next_action_url: nextAction(state),
    baseline_path: path.relative(workspace, baselinePath).split(path.sep).join('/'),
    current_projection: current,
    claims_boundary: 'Change against a selected baseline only. No security, compliance, certification, approval, or trustworthiness verdict is produced.'
  };
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  return { report, outputPath };
}

function main() {
  const failOn = input('fail-on', 'invalid').toLowerCase();
  try {
    const { report, outputPath } = run();
    setOutput('result-state', report.result_state);
    setOutput('current-hash', report.current_hash || report.baseline_hash || '');
    setOutput('expected-hash', report.expected_hash || '');
    setOutput('changed-field-count', report.changed_field_count || 0);
    setOutput('report-path', path.relative(process.env.GITHUB_WORKSPACE || process.cwd(), outputPath).split(path.sep).join('/'));
    setOutput('next-action-url', report.next_action_url || '');
    appendSummary(summary({ ...report, changed_fields: report.changed_fields || [] }));
    console.log(`ECZ-ID MSP Standard Drift: ${report.result_state}.`);
  } catch (error) {
    setOutput('result-state', 'INVALID_INPUT');
    setOutput('current-hash', '');
    setOutput('expected-hash', '');
    setOutput('changed-field-count', '0');
    setOutput('report-path', '');
    setOutput('next-action-url', '');
    appendSummary(`## ECZ-ID MSP Standard Drift\n\n**Result:** \`INVALID_INPUT\`\n\n${error.message}\n\nNo security or compliance verdict was produced.`);
    console.error(error.message);
    if (failOn !== 'never') process.exitCode = 2;
  }
}

if (require.main === module) main();

module.exports = { changedFields, normalizeBaselinePayload, projectionFor, run, summary };
