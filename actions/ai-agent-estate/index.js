'use strict';

const fs = require('fs');
const path = require('path');
const { inventory, normalizedHash, safeResolve, safeOutputPath } = require('../../src/index.js');

const AI_CATEGORIES = new Set(['agent', 'mcp', 'plugin', 'api', 'action_dependency', 'github_workflow']);

function input(name, fallback = '') {
  const value = process.env[`INPUT_${name.toUpperCase().replace(/-/g, '_')}`];
  return value == null || value === '' ? fallback : value;
}
function setOutput(name, value) {
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${String(value).replace(/\r?\n/g, ' ')}\n`, 'utf8');
}
function appendSummary(value) {
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${value}\n`, 'utf8');
}

function buildEstate(root, clientId) {
  const observed = inventory(root);
  const findings = observed.findings.filter((item) => AI_CATEGORIES.has(item.category));
  const categories = [...new Set(findings.map((item) => item.category))].sort();
  const highAuthority = categories.filter((item) => ['agent', 'mcp', 'plugin'].includes(item));
  let state = findings.length ? 'AI_AGENT_ESTATE_OBSERVED' : 'NO_AI_AGENT_SURFACES';
  if (highAuthority.length >= 2 && observed.identity_references.length === 0) state = 'REVIEW_RECOMMENDED';
  const payload = {
    schema_version: '1.0.0',
    client_id: clientId || null,
    categories,
    identity_references: observed.identity_references,
    findings
  };
  return {
    schema_version: '1.0.0',
    generated_at: new Date().toISOString(),
    result_state: state,
    client_id: clientId || null,
    estate_hash: normalizedHash(payload),
    surface_count: findings.length,
    categories,
    identity_references: observed.identity_references,
    findings,
    claims_boundary: 'Repository-declared AI/agent/MCP/plugin/workflow evidence only. This Action does not scan AI code for vulnerabilities or declare an agent safe, compliant, approved, or trustworthy.'
  };
}

function nextAction(report) {
  if (report.result_state === 'REVIEW_RECOMMENDED') {
    return 'https://msp.ecocitizenz.com/managed-ai?utm_source=github&utm_medium=action&utm_campaign=msp-ai-agent-estate&utm_content=review-recommended';
  }
  if (report.result_state === 'AI_AGENT_ESTATE_OBSERVED' && report.identity_references.length === 0) {
    return 'https://msp.ecocitizenz.com/trust-check?utm_source=github&utm_medium=action&utm_campaign=msp-ai-agent-estate&utm_content=identity-discovery';
  }
  if (report.result_state === 'AI_AGENT_ESTATE_OBSERVED') {
    return 'https://msp.ecocitizenz.com/managed-ai?utm_source=github&utm_medium=action&utm_campaign=msp-ai-agent-estate&utm_content=managed-accountability';
  }
  return '';
}

function summary(report) {
  const rows = report.categories.length
    ? report.categories.map((category) => `| ${category} | ${report.findings.filter((item) => item.category === category).length} |`).join('\n')
    : '| none observed | 0 |';
  const next = report.next_action_url ? `\n### One next step\n\n${report.result_state === 'REVIEW_RECOMMENDED'
    ? 'Multiple AI/machine authority surfaces were observed without a persistent identity reference. Review **Managed AI Accountability** if this is a managed customer estate.'
    : report.identity_references.length === 0
      ? 'Start with the free MSP Machine Trust Check to account for ownership, authority and evidence.'
      : 'If this AI/agent estate needs recurring customer evidence, review **Managed AI Accountability**.'}\n\n${report.next_action_url}\n` : '';
  return `## ECZ-ID MSP AI & Agent Estate\n\n**Result:** \`${report.result_state}\`  \n**Observed surfaces:** ${report.surface_count}  \n**Identity references:** ${report.identity_references.length}\n\n| Category | Observations |\n|---|---:|\n${rows}\n\n${report.claims_boundary}${next}`;
}

function run(options = {}) {
  const workspace = path.resolve(options.workspace || process.env.GITHUB_WORKSPACE || process.cwd());
  const root = safeResolve(workspace, options.path || input('path', '.'));
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) throw new Error('Inspection path does not exist or is not a directory.');
  const clientId = options.clientId != null ? options.clientId : input('client-id', '');
  const outputPath = safeOutputPath(workspace, options.output || input('output', 'eczid-msp-ai-agent-estate.json'));
  const report = buildEstate(root, clientId);
  report.next_action_url = nextAction(report);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  return { report, outputPath };
}

function main() {
  const failOn = input('fail-on', 'invalid').toLowerCase();
  try {
    const { report, outputPath } = run();
    setOutput('result-state', report.result_state);
    setOutput('surface-count', report.surface_count);
    setOutput('identity-reference-count', report.identity_references.length);
    setOutput('report-path', path.relative(process.env.GITHUB_WORKSPACE || process.cwd(), outputPath).split(path.sep).join('/'));
    setOutput('next-action-url', report.next_action_url);
    appendSummary(summary(report));
    console.log(`ECZ-ID MSP AI & Agent Estate: ${report.result_state}; ${report.surface_count} observations.`);
  } catch (error) {
    setOutput('result-state', 'INVALID_INPUT');
    setOutput('surface-count', '0');
    setOutput('identity-reference-count', '0');
    setOutput('report-path', '');
    setOutput('next-action-url', '');
    appendSummary(`## ECZ-ID MSP AI & Agent Estate\n\n**Result:** \`INVALID_INPUT\`\n\n${error.message}\n\nNo AI safety, security or compliance verdict was produced.`);
    console.error(error.message);
    if (failOn !== 'never') process.exitCode = 2;
  }
}

if (require.main === module) main();
module.exports = { buildEstate, nextAction, run, summary };
