'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { inventory, run, safeResolve } = require('../src/index.js');

function tempRepo() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'eczid-msp-estate-'));
}

function write(root, relative, content) {
  const file = path.join(root, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, 'utf8');
}

test('discovers GitHub workflow, MCP, agent, API and workload surfaces without treating missing ECZ-ID as failure', () => {
  const root = tempRepo();
  write(root, '.github/workflows/ci.yml', `name: CI\non: [push]\npermissions:\n  contents: read\n  id-token: write\njobs:\n  test:\n    runs-on: self-hosted\n    steps:\n      - uses: actions/checkout@v7\n`);
  write(root, '.github/workflows/review.md', '# Agentic workflow\nReview machine authority.\n');
  write(root, '.mcp.json', JSON.stringify({ mcpServers: { demo: { command: 'node', args: ['server.js'] } } }));
  write(root, 'openapi.yaml', 'openapi: 3.1.0\ninfo:\n  title: Demo API\n');
  write(root, 'Dockerfile', 'FROM node:24-alpine\n');

  const result = inventory(root);
  assert.equal(result.state, 'REVIEW_RECOMMENDED');
  assert.ok(result.categories.includes('github_workflow'));
  assert.ok(result.categories.includes('action_dependency'));
  assert.ok(result.categories.includes('agent'));
  assert.ok(result.categories.includes('mcp'));
  assert.ok(result.categories.includes('api'));
  assert.ok(result.categories.includes('service_workload'));
  assert.equal(result.identity_references.length, 0);
  assert.equal(result.signals.oidc, true);
  assert.equal(result.signals.self_hosted_runner, true);
});

test('records ECZ-ID references as evidence without changing them', () => {
  const root = tempRepo();
  write(root, '.mcp.json', '{"mcpServers":{"demo":{"url":"https://example.invalid/mcp"}}}');
  write(root, 'README.md', 'Identity: ECZ-GB-EXAMPLE123\nhttps://resolver.ecocitizenz.org/passport/ECZ-GB-EXAMPLE123\n');

  const result = inventory(root);
  assert.equal(result.state, 'MACHINE_ESTATE_OBSERVED');
  assert.ok(result.identity_references.some((value) => value === 'ECZ-GB-EXAMPLE123'));
  assert.ok(result.identity_references.some((value) => value.includes('resolver.ecocitizenz.org')));
});

test('empty repository stays neutral', () => {
  const root = tempRepo();
  write(root, 'README.md', '# Ordinary repository\nNo supported machine declarations here.\n');
  const result = inventory(root);
  assert.equal(result.state, 'NO_MACHINE_SURFACES');
  assert.equal(result.machine_count, 0);
});

test('run writes deterministic baseline payload and report inside workspace', () => {
  const root = tempRepo();
  write(root, 'action.yml', 'name: demo\nruns:\n  using: node24\n  main: index.js\n');
  const first = run({ workspace: root, path: '.', output: 'out/report.json', clientId: 'client-a' });
  const second = run({ workspace: root, path: '.', output: 'out/report-2.json', clientId: 'client-a' });
  assert.equal(first.report.baseline_hash, second.report.baseline_hash);
  assert.equal(first.report.client_id, 'client-a');
  assert.ok(fs.existsSync(first.outputPath));
});

test('inspection cannot escape the workspace', () => {
  const root = tempRepo();
  assert.throws(() => safeResolve(root, '..'), /inside GITHUB_WORKSPACE/);
});
