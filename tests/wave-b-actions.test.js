'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tenant = require('../actions/tenant-boundary-guard/index.js');
const aiEstate = require('../actions/ai-agent-estate/index.js');
const reliance = require('../actions/third-party-reliance/index.js');

function tempRepo() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'eczid-msp-wave-b-'));
}
function write(root, relative, content) {
  const file = path.join(root, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, 'utf8');
  return file;
}

test('Tenant Boundary Guard confirms exact client/environment/provider/target agreement without exposing target values', () => {
  const root = tempRepo();
  write(root, '.eczid/client-boundary.json', JSON.stringify({
    client_id: 'client-a',
    environment: 'production',
    provider: 'azure',
    target: 'tenant-123'
  }));
  const report = tenant.run({
    workspace: root,
    clientId: 'client-a',
    environment: 'production',
    provider: 'azure',
    expectedTarget: 'tenant-123',
    actualTarget: 'tenant-123'
  });
  assert.equal(report.result_state, 'BOUNDARY_CONFIRMED');
  assert.equal(report.reason_code, 'SUPPLIED_TARGET_AND_REPOSITORY_DECLARATION_MATCH');
  assert.notEqual(report.expected_target_hash, 'tenant-123');
  assert.match(report.next_action, /cloud IAM/i);
});

test('Tenant Boundary Guard blocks a wrong-customer target and uses a safety-first next action', () => {
  const root = tempRepo();
  const report = tenant.run({
    workspace: root,
    clientId: 'client-a',
    environment: 'production',
    provider: 'aws',
    expectedTarget: '111111111111',
    actualTarget: '222222222222'
  });
  assert.equal(report.result_state, 'BOUNDARY_MISMATCH');
  assert.equal(report.reason_code, 'ACTUAL_TARGET_DOES_NOT_MATCH_EXPECTED_TARGET');
  assert.match(report.next_action, /Stop before/i);
  assert.doesNotMatch(report.next_action, /ecocitizenz|buy|plan|apply/i);
});

test('AI & Agent Estate focuses on agent/MCP/plugin/workflow surfaces and routes relevant managed estates', () => {
  const root = tempRepo();
  write(root, '.github/workflows/agent-review.md', '# Agent workflow\nUse MCP tools for review.\n');
  write(root, '.mcp.json', JSON.stringify({ mcpServers: { demo: { url: 'https://mcp.vendor.example/tools' } } }));
  write(root, 'action.yml', 'name: helper\nruns:\n  using: node24\n  main: index.js\n');
  const { report } = aiEstate.run({ workspace: root, path: '.', clientId: 'client-a', output: 'ai.json' });
  assert.equal(report.result_state, 'REVIEW_RECOMMENDED');
  assert.ok(report.categories.includes('agent'));
  assert.ok(report.categories.includes('mcp'));
  assert.ok(report.categories.includes('plugin'));
  assert.match(report.next_action_url, /managed-ai/);
  assert.match(report.claims_boundary, /does not scan AI code for vulnerabilities/i);
});

test('Third-Party Reliance Gate inventories external Actions and machine endpoints without assigning vendor risk', () => {
  const root = tempRepo();
  write(root, '.github/workflows/ci.yml', `name: CI\non: [push]\njobs:\n  check:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v7\n      - uses: ./local-action\n`);
  write(root, '.mcp.json', JSON.stringify({ mcpServers: { vendor: { url: 'https://mcp.vendor.example/tools' } } }));
  const { report } = reliance.run({ workspace: root, path: '.', clientId: 'client-a', output: 'reliance.json' });
  assert.equal(report.result_state, 'REVIEW_RECOMMENDED');
  assert.ok(report.entries.some((entry) => entry.kind === 'github_action_or_reusable_workflow' && entry.locator === 'actions/checkout@v7'));
  assert.ok(report.entries.some((entry) => entry.hostname === 'mcp.vendor.example'));
  assert.equal(report.mutable_action_ref_count, 1);
  assert.match(report.claims_boundary, /No vendor-risk/i);
});

test('Third-Party Reliance Gate ignores ECZ-ID Resolver links as external vendor reliance', () => {
  const root = tempRepo();
  write(root, '.mcp.json', JSON.stringify({
    mcpServers: { demo: { url: 'https://resolver.ecocitizenz.org/passport/ECZ-GB-DEMO123' } }
  }));
  const { report } = reliance.run({ workspace: root, path: '.', output: 'reliance.json' });
  assert.equal(report.entries.some((entry) => entry.hostname === 'resolver.ecocitizenz.org'), false);
});
