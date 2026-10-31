'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { input, safeResolve } = require('../../src/index.js');

const PROVIDERS = new Set(['azure', 'aws', 'gcp', 'generic']);

function setOutput(name, value) {
  if (!process.env.GITHUB_OUTPUT) return;
  fs.appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${String(value).replace(/\r?\n/g, ' ')}\n`, 'utf8');
}
function appendSummary(value) {
  if (!process.env.GITHUB_STEP_SUMMARY) return;
  fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${value}\n`, 'utf8');
}
function normalize(value) { return String(value == null ? '' : value).trim(); }
function digest(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function boundaryTuple({ clientId, environment, provider, expectedTarget, actualTarget }) {
  return { client_id: normalize(clientId), environment: normalize(environment).toLowerCase(), provider: normalize(provider).toLowerCase(), expected_target_hash: digest(normalize(expectedTarget)), actual_target_hash: digest(normalize(actualTarget)) };
}
function readDeclaration(workspace, relative) {
  const file = safeResolve(workspace, relative);
  if (!fs.existsSync(file)) return null;
  let parsed;
  try { parsed = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (error) { throw new Error(`Unable to parse boundary declaration JSON: ${error.message}`); }
  if (!parsed || typeof parsed !== 'object') throw new Error('Boundary declaration must be a JSON object.');
  return { client_id: normalize(parsed.client_id), environment: normalize(parsed.environment).toLowerCase(), provider: normalize(parsed.provider || 'generic').toLowerCase(), target: normalize(parsed.target) };
}
function evaluateBoundary(values, declaration) {
  const supplied = { client_id: normalize(values.clientId), environment: normalize(values.environment).toLowerCase(), provider: normalize(values.provider).toLowerCase(), expected_target: normalize(values.expectedTarget), actual_target: normalize(values.actualTarget) };
  if (!supplied.client_id || !supplied.environment || !supplied.expected_target || !supplied.actual_target) throw new Error('client-id, environment, expected-target and actual-target are required.');
  if (!PROVIDERS.has(supplied.provider)) throw new Error(`Unsupported provider: ${supplied.provider}`);
  if (supplied.expected_target !== supplied.actual_target) return { state: 'BOUNDARY_MISMATCH', reason: 'ACTUAL_TARGET_DOES_NOT_MATCH_EXPECTED_TARGET', next_action: 'Stop before the sensitive deployment step and have a human confirm the intended customer/environment target.' };
  if (!declaration) return { state: 'DECLARATION_MISSING', reason: 'CLIENT_BOUNDARY_DECLARATION_NOT_OBSERVED', next_action: 'Review the supplied boundary and consider committing an MSP-approved .eczid/client-boundary.json declaration for repeatable checks.' };
  const declarationMatches = declaration.client_id === supplied.client_id && declaration.environment === supplied.environment && declaration.provider === supplied.provider && declaration.target === supplied.expected_target;
  if (!declarationMatches) return { state: 'DECLARATION_MISMATCH', reason: 'REPOSITORY_DECLARATION_DOES_NOT_MATCH_SUPPLIED_BOUNDARY', next_action: 'Do not treat this as an approval. Have a human reconcile the repository declaration with the intended customer/environment target.' };
  return { state: 'BOUNDARY_CONFIRMED', reason: 'SUPPLIED_TARGET_AND_REPOSITORY_DECLARATION_MATCH', next_action: 'Proceed only if your cloud IAM, change-control and deployment policy also allow the operation.' };
}
function run(options = {}) {
  const workspace = path.resolve(options.workspace || process.env.GITHUB_WORKSPACE || process.cwd());
  const values = {
    clientId: options.clientId != null ? options.clientId : input('client-id'),
    environment: options.environment != null ? options.environment : input('environment'),
    provider: options.provider != null ? options.provider : input('provider', 'generic'),
    expectedTarget: options.expectedTarget != null ? options.expectedTarget : input('expected-target'),
    actualTarget: options.actualTarget != null ? options.actualTarget : input('actual-target')
  };
  const declarationPath = options.declaration || input('declaration', '.eczid/client-boundary.json');
  const declaration = readDeclaration(workspace, declarationPath);
  const outcome = evaluateBoundary(values, declaration);
  const tuple = boundaryTuple(values);
  return { schema_version: '1.0.0', result_state: outcome.state, reason_code: outcome.reason, next_action: outcome.next_action, client_id: tuple.client_id, environment: tuple.environment, provider: tuple.provider, expected_target_hash: tuple.expected_target_hash, actual_target_hash: tuple.actual_target_hash, boundary_hash: digest(JSON.stringify(tuple)), declaration_observed: Boolean(declaration), claims_boundary: 'This is a customer/tenant boundary consistency guard. It does not replace cloud IAM, provider authentication, change approval, or security/compliance controls.' };
}
function summary(report) { return `## ECZ-ID MSP Tenant Boundary Guard\n\n**Result:** \`${report.result_state}\`  \n**Client:** \`${report.client_id}\`  \n**Environment:** \`${report.environment}\`  \n**Provider:** \`${report.provider}\`  \n**Reason:** \`${report.reason_code}\`\n\n### Next action\n\n${report.next_action}\n\nTarget identifiers are not printed; only hashes are retained in the result. ${report.claims_boundary}`; }
function main() {
  const failOnMismatch = input('fail-on-mismatch', 'true').toLowerCase() !== 'false';
  try {
    const report = run();
    setOutput('result-state', report.result_state); setOutput('boundary-hash', report.boundary_hash); setOutput('reason-code', report.reason_code); setOutput('next-action', report.next_action);
    appendSummary(summary(report)); console.log(`ECZ-ID MSP Tenant Boundary Guard: ${report.result_state}.`);
    if (failOnMismatch && ['BOUNDARY_MISMATCH', 'DECLARATION_MISMATCH'].includes(report.result_state)) process.exitCode = 3;
  } catch (error) {
    setOutput('result-state', 'INVALID_INPUT'); setOutput('boundary-hash', ''); setOutput('reason-code', 'INVALID_INPUT'); setOutput('next-action', 'Correct the Action inputs or boundary declaration before continuing.');
    appendSummary(`## ECZ-ID MSP Tenant Boundary Guard\n\n**Result:** \`INVALID_INPUT\`\n\n${error.message}\n\nNo target identifiers were emitted and no security/compliance verdict was produced.`); console.error(error.message); process.exitCode = 2;
  }
}
if (require.main === module) main();
module.exports = { boundaryTuple, evaluateBoundary, readDeclaration, run, summary };
