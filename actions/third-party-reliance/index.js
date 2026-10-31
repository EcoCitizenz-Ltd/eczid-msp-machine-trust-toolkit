'use strict';

const fs = require('fs');
const path = require('path');
const { input, inventory, normalizedHash, safeResolve, safeOutputPath } = require('../../src/index.js');

function setOutput(name, value) {
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${String(value).replace(/\r?\n/g, ' ')}\n`, 'utf8');
}
function appendSummary(value) {
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${value}\n`, 'utf8');
}
function externalUrls(text) {
  const matches = String(text).match(/https?:\/\/[^\s'"<>),\]}]+/gi) || [];
  return [...new Set(matches.map((value) => value.replace(/[.;:]+$/, '')))].sort();
}
function relianceRegister(root) {
  const observed = inventory(root); const entries = []; const seen = new Set();
  const add = (entry) => { const key = `${entry.kind}\u0000${entry.file}\u0000${entry.locator}`; if (seen.has(key)) return; seen.add(key); entries.push(entry); };
  for (const finding of observed.findings.filter((item) => item.category === 'action_dependency')) {
    if (finding.detail.startsWith('./') || finding.detail.startsWith('../')) continue;
    add({ kind: 'github_action_or_reusable_workflow', file: finding.file, locator: finding.detail, immutable_reference: Boolean(finding.immutable_ref) });
  }
  const machineFiles = new Set(observed.findings.filter((item) => ['mcp', 'agent', 'api'].includes(item.category)).map((item) => item.file));
  for (const relative of machineFiles) {
    const full = safeResolve(root, relative); let text = '';
    try { const stat = fs.statSync(full); if (!stat.isFile() || stat.size > 1024 * 1024) continue; text = fs.readFileSync(full, 'utf8'); } catch { continue; }
    for (const url of externalUrls(text)) {
      let hostname = ''; try { hostname = new URL(url).hostname.toLowerCase(); } catch { continue; }
      if (!hostname || ['resolver.ecocitizenz.org', 'resolver.ecocitizenz.com'].includes(hostname)) continue;
      const kind = observed.findings.some((item) => item.file === relative && item.category === 'mcp') ? 'mcp_or_machine_endpoint' : observed.findings.some((item) => item.file === relative && item.category === 'api') ? 'api_or_service_endpoint' : 'agent_external_reference';
      add({ kind, file: relative, locator: url, hostname });
    }
  }
  entries.sort((a, b) => `${a.kind}:${a.file}:${a.locator}`.localeCompare(`${b.kind}:${b.file}:${b.locator}`));
  const mutable = entries.filter((entry) => entry.kind === 'github_action_or_reusable_workflow' && !entry.immutable_reference);
  const externalMachine = entries.filter((entry) => entry.kind !== 'github_action_or_reusable_workflow');
  let state = entries.length ? 'RELIANCE_OBSERVED' : 'NO_EXTERNAL_RELIANCE';
  if (mutable.length > 0 || externalMachine.length >= 2) state = 'REVIEW_RECOMMENDED';
  return { state, entries, mutable_action_ref_count: mutable.length, identity_references: observed.identity_references, categories: observed.categories };
}
function nextAction(report) {
  if (!['RELIANCE_OBSERVED', 'REVIEW_RECOMMENDED'].includes(report.result_state)) return '';
  return 'https://msp.ecocitizenz.com/apply?plan=core&utm_source=github&utm_medium=action&utm_campaign=msp-third-party-reliance&utm_content=continuous-currentness';
}
function summary(report) {
  const rows = report.entries.length ? report.entries.map((entry) => `| ${entry.kind} | ${entry.file} | ${entry.locator.replace(/\|/g, '\\|')} | ${entry.immutable_reference == null ? 'n/a' : entry.immutable_reference ? 'yes' : 'no'} |`).join('\n') : '| none observed | - | - | - |';
  const next = report.next_action_url ? `\n### One next step\n\nIf this reliance register needs continuous re-checking across multiple customer repositories, review **Machine Trust Core**.\n\n${report.next_action_url}\n` : '';
  return `## ECZ-ID MSP Third-Party Reliance Gate\n\n**Result:** \`${report.result_state}\`  \n**Reliance references:** ${report.reliance_count}  \n**Mutable Action refs:** ${report.mutable_action_ref_count}\n\n| Kind | Source file | Locator | Immutable Action ref |\n|---|---|---|---|\n${rows}\n\nThis is a supported reliance inventory, not a vendor-risk score. An external or mutable dependency is not automatically unsafe, non-compliant, or untrustworthy.${next}`;
}
function run(options = {}) {
  const workspace = path.resolve(options.workspace || process.env.GITHUB_WORKSPACE || process.cwd());
  const root = safeResolve(workspace, options.path || input('path', '.'));
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) throw new Error('Inspection path does not exist or is not a directory.');
  const clientId = options.clientId != null ? options.clientId : input('client-id', '');
  const outputPath = safeOutputPath(workspace, options.output || input('output', 'eczid-msp-third-party-reliance.json'));
  const observed = relianceRegister(root);
  const payload = { schema_version: '1.0.0', client_id: clientId || null, entries: observed.entries, identity_references: observed.identity_references };
  const report = { schema_version: '1.0.0', generated_at: new Date().toISOString(), result_state: observed.state, client_id: clientId || null, reliance_count: observed.entries.length, mutable_action_ref_count: observed.mutable_action_ref_count, register_hash: normalizedHash(payload), identity_references: observed.identity_references, entries: observed.entries, claims_boundary: 'Supported third-party reliance inventory only. No vendor-risk, security, compliance, certification, approval, or trustworthiness verdict is produced.' };
  report.next_action_url = nextAction(report);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true }); fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8'); return { report, outputPath };
}
function main() {
  const failOn = input('fail-on', 'invalid').toLowerCase();
  try {
    const { report, outputPath } = run();
    setOutput('result-state', report.result_state); setOutput('reliance-count', report.reliance_count); setOutput('mutable-action-ref-count', report.mutable_action_ref_count); setOutput('register-hash', report.register_hash); setOutput('report-path', path.relative(process.env.GITHUB_WORKSPACE || process.cwd(), outputPath).split(path.sep).join('/')); setOutput('next-action-url', report.next_action_url);
    appendSummary(summary(report)); console.log(`ECZ-ID MSP Third-Party Reliance Gate: ${report.result_state}; ${report.reliance_count} references.`);
  } catch (error) {
    setOutput('result-state', 'INVALID_INPUT'); setOutput('reliance-count', '0'); setOutput('mutable-action-ref-count', '0'); setOutput('register-hash', ''); setOutput('report-path', ''); setOutput('next-action-url', '');
    appendSummary(`## ECZ-ID MSP Third-Party Reliance Gate\n\n**Result:** \`INVALID_INPUT\`\n\n${error.message}\n\nNo vendor-risk, security or compliance verdict was produced.`); console.error(error.message); if (failOn !== 'never') process.exitCode = 2;
  }
}
if (require.main === module) main();
module.exports = { externalUrls, relianceRegister, run, summary };
