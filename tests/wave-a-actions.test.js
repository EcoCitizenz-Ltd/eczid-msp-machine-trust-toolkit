'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const baseline = require('../actions/client-trust-baseline/index.js');
const drift = require('../actions/standard-drift/index.js');
const evidence = require('../actions/evidence-qbr-pack/index.js');

function tempRepo() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'eczid-msp-wave-a-'));
}

function write(root, relative, content) {
  const file = path.join(root, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, 'utf8');
  return file;
}

function seedRepo(root) {
  write(root, '.github/workflows/deploy.yml', `name: Deploy\non: [push]\npermissions:\n  contents: read\n  id-token: write\njobs:\n  deploy:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1\n`);
  write(root, '.mcp.json', JSON.stringify({ mcpServers: { customer: { url: 'https://example.invalid/mcp' } } }));
  write(root, 'README.md', 'Operator identity: ECZ-GB-EXAMPLE123\nhttps://resolver.ecocitizenz.org/passport/ECZ-GB-EXAMPLE123\n');
}

test('Client Trust Baseline records a neutral technical baseline', () => {
  const root = tempRepo();
  seedRepo(root);
  const { report } = baseline.run({ workspace: root, path: '.', profile: 'onboarding', clientId: 'client-a', output: 'baseline.json' });
  assert.equal(report.result_state, 'BASELINE_OBSERVED');
  assert.equal(report.client_id, 'client-a');
  assert.equal(report.workflow_posture.oidc_observed, true);
  assert.equal(report.workflow_posture.mutable_action_ref_count, 0);
  assert.ok(report.identity_references.includes('ECZ-GB-EXAMPLE123'));
  assert.match(report.claims_boundary, /does not state or certify compliance/i);
});

test('Client Trust Baseline recommends review for mutable references without failing security', () => {
  const root = tempRepo();
  write(root, '.github/workflows/ci.yml', `name: CI\non: [push]\njobs:\n  ci:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v7\n`);
  write(root, 'Dockerfile', 'FROM node:24-alpine\n');
  const { report } = baseline.run({ workspace: root, path: '.', profile: 'quarterly-review', output: 'baseline.json' });
  assert.equal(report.result_state, 'REVIEW_RECOMMENDED');
  assert.ok(report.review_reasons.includes('MUTABLE_ACTION_REFERENCES_OBSERVED'));
  assert.equal(report.workflow_posture.mutable_action_ref_count, 1);
});

test('Standard Drift proposes a baseline and then detects a changed projection', () => {
  const root = tempRepo();
  seedRepo(root);

  const proposal = drift.run({
    workspace: root,
    path: '.',
    baseline: '.eczid/msp-baseline.json',
    output: 'proposal.json',
    mode: 'propose',
    clientId: 'client-a'
  });
  assert.equal(proposal.report.result_state, 'BASELINE_PROPOSED');

  const proposed = JSON.parse(fs.readFileSync(path.join(root, 'proposal.json'), 'utf8'));
  write(root, '.eczid/msp-baseline.json', JSON.stringify(proposed, null, 2));

  const noChange = drift.run({ workspace: root, path: '.', baseline: '.eczid/msp-baseline.json', output: 'no-change.json', clientId: 'client-a' });
  assert.equal(noChange.report.result_state, 'NO_CHANGE');

  write(root, 'Dockerfile', 'FROM node:24-alpine\n');
  const changed = drift.run({ workspace: root, path: '.', baseline: '.eczid/msp-baseline.json', output: 'changed.json', clientId: 'client-a' });
  assert.equal(changed.report.result_state, 'CHANGED');
  assert.ok(changed.report.changed_fields.includes('categories'));
  assert.match(changed.report.next_action_url, /plan=core/);
});

test('Evidence & QBR Pack emits observed/not_observed evidence and never a compliance verdict', () => {
  const root = tempRepo();
  seedRepo(root);
  const { pack, markdown } = evidence.run({
    workspace: root,
    path: '.',
    profile: 'nis2',
    clientId: 'client-a',
    outputJson: 'evidence.json',
    outputMarkdown: 'evidence.md'
  });
  assert.equal(pack.result_state, 'EVIDENCE_PACK_CREATED');
  assert.equal(pack.profile, 'nis2');
  assert.ok(pack.observations.some((item) => item.key === 'oidc' && item.state === 'observed'));
  assert.match(markdown, /do not assert that a framework control is satisfied/i);
  assert.match(pack.next_action_url, /plan=core/);
});

test('unsupported profiles fail closed as invalid input candidates', () => {
  const root = tempRepo();
  assert.throws(
    () => baseline.run({ workspace: root, path: '.', profile: 'magic-certification', output: 'x.json' }),
    /Unsupported profile/
  );
  assert.throws(
    () => evidence.run({ workspace: root, path: '.', profile: 'instant-compliance', outputJson: 'x.json', outputMarkdown: 'x.md' }),
    /Unsupported profile/
  );
});
