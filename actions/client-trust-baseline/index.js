'use strict';

const fs = require('fs');
const path = require('path');
const {
  input,
  inventory,
  normalizedHash,
  safeResolve,
  safeOutputPath
} = require('../../src/index.js');

const ALLOWED_PROFILES = new Set(['onboarding', 'quarterly-review', 'pre-renewal', 'continuous']);

function setOutput(name, value) {
  if (!process.env.GITHUB_OUTPUT) return;
  fs.appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${String(value).replace(/\r?\n/g, ' ')}\n`, 'utf8');
}

function appendSummary(value) {
  if (!process.env.GITHUB_STEP_SUMMARY) return;
  fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${value}\n`, 'utf8');
}

function buildBaseline(root, profile, clientId) {
  const observed = inventory(root);
  const deps = observed.findings.filter((finding) => finding.category === 'action_dependency');
  const mutableRefs = deps.filter((finding) => !finding.immutable_ref);
  const immutableRefs = deps.filter((finding) => finding.immutable_ref);
  const attestations = deps.filter((finding) => /^actions\/attest-(?:build-provenance|sbom)@/i.test(finding.detail));
  const reviewReasons = [];
  if (observed.state === 'REVIEW_RECOMMENDED') reviewReasons.push('MULTIPLE_MACHINE_SURFACES_WITHOUT_IDENTITY_REFERENCE');
  if (observed.signals.write_all) reviewReasons.push('WORKFLOW_WRITE_ALL_OBSERVED');
  if (observed.signals.pull_request_target) reviewReasons.push('PULL_REQUEST_TARGET_OBSERVED');
  if (mutableRefs.length > 0) reviewReasons.push('MUTABLE_ACTION_REFERENCES_OBSERVED');
  let state = 'NO_MACHINE_SURFACES';
  if (observed.machine_count > 0) state = 'BASELINE_OBSERVED';
  if (reviewReasons.length > 0) state = 'REVIEW_RECOMMENDED';
  const projection = {
    schema_version: '1.0.0', client_id: clientId || null, profile, categories: observed.categories,
    identity_references: observed.identity_references, signals: observed.signals,
    action_dependencies: deps.map((finding) => ({ file: finding.file, ref: finding.detail, immutable_ref: Boolean(finding.immutable_ref) })), findings: observed.findings
  };
  return {
    schema_version: '1.0.0', generated_at: new Date().toISOString(), result_state: state,
    baseline_hash: normalizedHash(projection), client_id: clientId || null, profile,
    machine_count: observed.machine_count, category_count: observed.category_count,
    identity_references: observed.identity_references, categories: observed.categories,
    workflow_posture: {
      actions_lock_observed: observed.signals.actions_lock, oidc_observed: observed.signals.oidc,
      self_hosted_runner_observed: observed.signals.self_hosted_runner, pull_request_target_observed: observed.signals.pull_request_target,
      write_all_observed: observed.signals.write_all, action_dependency_count: deps.length,
      immutable_action_ref_count: immutableRefs.length, mutable_action_ref_count: mutableRefs.length,
      artifact_attestation_action_count: attestations.length
    }, review_reasons: reviewReasons, projection,
    claims_boundary: 'Technical repository evidence only. This report does not state or certify compliance, security, approval, trustworthiness, or audit success.'
  };
}

function nextAction(report) {
  if (report.result_state === 'REVIEW_RECOMMENDED') return 'https://msp.ecocitizenz.com/audit?utm_source=github&utm_medium=action&utm_campaign=msp-client-baseline&utm_content=review-recommended';
  if (report.result_state === 'BASELINE_OBSERVED' && report.identity_references.length === 0) return 'https://msp.ecocitizenz.com/trust-check?utm_source=github&utm_medium=action&utm_campaign=msp-client-baseline&utm_content=baseline-observed';
  return '';
}

function summary(report, url) {
  const posture = report.workflow_posture;
  const reasonText = report.review_reasons.length ? report.review_reasons.map((reason) => `- ${reason}`).join('\n') : '- None';
  const next = url ? `\n### One next step\n\n${report.result_state === 'REVIEW_RECOMMENDED' ? 'This repository has observations that deserve a bounded human review if they represent a customer estate. Review the fixed-scope **£395 Client-Estate Machine Trust Baseline**.' : 'A machine estate is observable. Start with the free MSP Machine Trust Check if you want to account for ownership, authority and evidence.'}\n\n${url}\n` : '';
  return `## ECZ-ID MSP Client Trust Baseline\n\n**Profile:** \`${report.profile}\`  \n**Result:** \`${report.result_state}\`  \n**Machine observations:** ${report.machine_count}  \n**Baseline hash:** \`${report.baseline_hash}\`\n\n### Workflow evidence observed\n\n| Observation | Value |\n|---|---:|\n| Workflow lockfile | ${posture.actions_lock_observed ? 'observed' : 'not observed'} |\n| OIDC declaration | ${posture.oidc_observed ? 'observed' : 'not observed'} |\n| Self-hosted runner reference | ${posture.self_hosted_runner_observed ? 'observed' : 'not observed'} |\n| pull_request_target | ${posture.pull_request_target_observed ? 'observed' : 'not observed'} |\n| write-all permissions | ${posture.write_all_observed ? 'observed' : 'not observed'} |\n| Mutable Action refs | ${posture.mutable_action_ref_count} |\n| Immutable Action refs | ${posture.immutable_action_ref_count} |\n| Attestation Actions | ${posture.artifact_attestation_action_count} |\n\n### Review reasons\n\n${reasonText}\n\nThese are repository observations only. “Not observed” is not the same as non-compliant, and this Action does not issue a compliance or security verdict.${next}`;
}

function run(options = {}) {
  const workspace = path.resolve(options.workspace || process.env.GITHUB_WORKSPACE || process.cwd());
  const root = safeResolve(workspace, options.path || input('path', '.'));
  const profile = String(options.profile || input('profile', 'onboarding')).toLowerCase();
  if (!ALLOWED_PROFILES.has(profile)) throw new Error(`Unsupported profile: ${profile}`);
  const clientId = options.clientId != null ? options.clientId : input('client-id', '');
  const outputPath = safeOutputPath(workspace, options.output || input('output', 'eczid-msp-client-baseline.json'));
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) throw new Error('Inspection path does not exist or is not a directory.');
  const report = buildBaseline(root, profile, clientId);
  const url = nextAction(report); report.next_action_url = url;
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  return { report, outputPath, url };
}

function main() {
  const failOn = input('fail-on', 'invalid').toLowerCase();
  try {
    const { report, outputPath, url } = run();
    setOutput('result-state', report.result_state); setOutput('baseline-hash', report.baseline_hash); setOutput('machine-count', report.machine_count);
    setOutput('mutable-action-ref-count', report.workflow_posture.mutable_action_ref_count); setOutput('identity-reference-count', report.identity_references.length);
    setOutput('report-path', path.relative(process.env.GITHUB_WORKSPACE || process.cwd(), outputPath).split(path.sep).join('/')); setOutput('next-action-url', url);
    appendSummary(summary(report, url)); console.log(`ECZ-ID MSP Client Trust Baseline: ${report.result_state}; ${report.machine_count} observations.`);
  } catch (error) {
    setOutput('result-state', 'INVALID_INPUT'); setOutput('baseline-hash', ''); setOutput('machine-count', '0'); setOutput('mutable-action-ref-count', '0'); setOutput('identity-reference-count', '0'); setOutput('report-path', ''); setOutput('next-action-url', '');
    appendSummary(`## ECZ-ID MSP Client Trust Baseline\n\n**Result:** \`INVALID_INPUT\`\n\n${error.message}\n\nNo compliance or security verdict was produced.`); console.error(error.message); if (failOn !== 'never') process.exitCode = 2;
  }
}

if (require.main === module) main();
module.exports = { buildBaseline, nextAction, run, summary };
