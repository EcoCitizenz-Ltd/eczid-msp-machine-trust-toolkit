'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MAX_FILES = 10000;
const MAX_TEXT_BYTES = 1024 * 1024;
const SKIP_DIRS = new Set([
  '.git', 'node_modules', 'vendor', 'dist', 'build', 'coverage', '.venv', 'venv',
  '.tox', '.pytest_cache', '.mypy_cache', '.next', 'target', 'bin', 'obj'
]);

const TEXT_EXTENSIONS = new Set([
  '.yml', '.yaml', '.json', '.jsonc', '.toml', '.md', '.txt', '.xml', '.ini', '.cfg',
  '.conf', '.properties', '.tf', '.tfvars', '.js', '.cjs', '.mjs', '.ts', '.tsx', '.py',
  '.go', '.rs', '.csproj', '.fsproj', '.vbproj'
]);

function input(name, fallback = '') {
  const value = process.env[`INPUT_${name.toUpperCase().replace(/-/g, '_')}`];
  return value == null || value === '' ? fallback : value;
}

function setOutput(name, value) {
  const output = process.env.GITHUB_OUTPUT;
  if (!output) return;
  fs.appendFileSync(output, `${name}=${String(value).replace(/\r?\n/g, ' ')}\n`, 'utf8');
}

function appendSummary(markdown) {
  const summary = process.env.GITHUB_STEP_SUMMARY;
  if (!summary) return;
  fs.appendFileSync(summary, `${markdown}\n`, 'utf8');
}

function inside(parent, candidate) {
  const rel = path.relative(parent, candidate);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function safeResolve(workspace, requested) {
  const resolved = path.resolve(workspace, requested || '.');
  if (!inside(workspace, resolved)) {
    throw new Error('Inspection path must remain inside GITHUB_WORKSPACE.');
  }
  return resolved;
}

function safeOutputPath(workspace, requested) {
  const resolved = path.resolve(workspace, requested || 'eczid-msp-machine-estate.json');
  if (!inside(workspace, resolved)) {
    throw new Error('Output path must remain inside GITHUB_WORKSPACE.');
  }
  return resolved;
}

function walk(root) {
  const files = [];
  const stack = [root];
  while (stack.length) {
    const current = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (files.length >= MAX_FILES) return files;
      const full = path.join(current, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) stack.push(full);
        continue;
      }
      if (entry.isFile()) files.push(full);
    }
  }
  return files;
}

function readText(file) {
  let stat;
  try {
    stat = fs.statSync(file);
  } catch {
    return '';
  }
  if (!stat.isFile() || stat.size > MAX_TEXT_BYTES) return '';
  const base = path.basename(file).toLowerCase();
  const ext = path.extname(base);
  const knownName = [
    'dockerfile', 'containerfile', 'makefile', 'package.json', 'pyproject.toml',
    'cargo.toml', 'go.mod', 'action.yml', 'action.yaml', 'server.json'
  ].includes(base);
  if (!knownName && !TEXT_EXTENSIONS.has(ext)) return '';
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return '';
  }
}

function rel(root, file) {
  return path.relative(root, file).split(path.sep).join('/');
}

function addFinding(findings, seen, category, file, detail, evidence = {}) {
  const key = `${category}\u0000${file}\u0000${detail}`;
  if (seen.has(key)) return;
  seen.add(key);
  findings.push({ category, file, detail, ...evidence });
}

function uniqueMatches(text, regex) {
  const out = new Set();
  let match;
  const r = new RegExp(regex.source, regex.flags.includes('g') ? regex.flags : `${regex.flags}g`);
  while ((match = r.exec(text)) !== null) {
    out.add(match[1] || match[0]);
    if (match.index === r.lastIndex) r.lastIndex += 1;
  }
  return [...out];
}

function classifyFile(relative, text, findings, seen, identityRefs, signals) {
  const lower = relative.toLowerCase();
  const base = path.basename(lower);

  // GitHub Actions and reusable workflows.
  if (/^\.github\/workflows\/.*\.(ya?ml)$/i.test(relative)) {
    addFinding(findings, seen, 'github_workflow', relative, 'GitHub Actions workflow');
    const uses = uniqueMatches(text, /^\s*uses:\s*([^\s#]+).*$/gim);
    for (const ref of uses) {
      addFinding(findings, seen, 'action_dependency', relative, ref, {
        immutable_ref: /@[0-9a-f]{40}$/i.test(ref)
      });
    }
    if (/\bpull_request_target\s*:/i.test(text)) signals.pull_request_target = true;
    if (/\bruns-on\s*:\s*(?:\[[^\]]*\bself-hosted\b[^\]]*\]|self-hosted)\b/i.test(text)) {
      signals.self_hosted_runner = true;
    }
    if (/\bid-token\s*:\s*write\b/i.test(text)) signals.oidc = true;
    if (/\bpermissions\s*:\s*write-all\b/i.test(text)) signals.write_all = true;
  }

  // GitHub agentic workflows and agent definitions.
  if (/^\.github\/workflows\/.*\.md$/i.test(relative) || /^\.github\/agents\/.*\.(?:md|ya?ml|json)$/i.test(relative)) {
    addFinding(findings, seen, 'agent', relative, 'Agent or agentic workflow definition');
  }

  // MCP declarations/configuration.
  if (
    /(^|\/)(?:\.mcp|mcp[^/]*)\.(?:json|jsonc|ya?ml|toml)$/i.test(relative) ||
    /\bmcpservers?\b/i.test(text) ||
    /\bmcp:\/\//i.test(text)
  ) {
    addFinding(findings, seen, 'mcp', relative, 'MCP configuration or reference');
  }

  // Plugin / Action publisher surfaces.
  if (base === 'action.yml' || base === 'action.yaml' || /(^|\/)plugin\.json$/i.test(relative) || /\.claude-plugin\//i.test(relative)) {
    addFinding(findings, seen, 'plugin', relative, 'Plugin or GitHub Action definition');
  }

  // API surfaces.
  if (/((^|\/)(openapi|swagger)[^/]*\.(json|ya?ml)$)/i.test(relative) || /^\s*(openapi|swagger)\s*:/im.test(text)) {
    addFinding(findings, seen, 'api', relative, 'OpenAPI/Swagger declaration');
  }

  // SDK/package publisher surfaces.
  if (['package.json', 'pyproject.toml', 'cargo.toml', 'go.mod'].includes(base) || /\.(?:csproj|fsproj|vbproj)$/i.test(base)) {
    addFinding(findings, seen, 'sdk_or_package', relative, 'Package or SDK metadata');
  }

  // Service/workload declarations.
  if (
    ['dockerfile', 'containerfile'].includes(base) ||
    /(^|\/)(docker-compose|compose)\.(ya?ml)$/i.test(relative) ||
    /(^|\/)k8s\//i.test(relative) ||
    /(^|\/)kubernetes\//i.test(relative) ||
    /\.(tf|tfvars)$/i.test(relative) ||
    /^\s*kind\s*:\s*(Deployment|StatefulSet|DaemonSet|Job|CronJob|Service)\b/im.test(text)
  ) {
    addFinding(findings, seen, 'service_workload', relative, 'Service, workload, container, or infrastructure declaration');
  }

  // ECZ-ID public identity references. We only observe; absence is neutral.
  for (const id of uniqueMatches(text, /\b(ECZ-[A-Z0-9][A-Z0-9-]{3,})\b/gi)) identityRefs.add(id.toUpperCase());
  for (const url of uniqueMatches(text, /(https?:\/\/resolver\.ecocitizenz\.(?:org|com)\/[^\s)'"<>]+)/gi)) identityRefs.add(url);
}

function inventory(root) {
  const files = walk(root);
  const findings = [];
  const seen = new Set();
  const identityRefs = new Set();
  const signals = {
    actions_lock: false,
    pull_request_target: false,
    self_hosted_runner: false,
    oidc: false,
    write_all: false
  };

  for (const file of files) {
    const relative = rel(root, file);
    if (relative === '.github/workflows/actions.lock' || path.basename(relative) === 'actions.lock') {
      signals.actions_lock = true;
    }
    const text = readText(file);
    if (!text) continue;
    classifyFile(relative, text, findings, seen, identityRefs, signals);
  }

  findings.sort((a, b) => `${a.category}:${a.file}:${a.detail}`.localeCompare(`${b.category}:${b.file}:${b.detail}`));
  const categories = [...new Set(findings.map((f) => f.category))].sort();
  const highAuthority = new Set(['agent', 'mcp', 'plugin', 'service_workload']);
  const highAuthorityCategories = categories.filter((c) => highAuthority.has(c));

  let state = 'NO_MACHINE_SURFACES';
  if (findings.length > 0) state = 'MACHINE_ESTATE_OBSERVED';
  if (highAuthorityCategories.length >= 2 && identityRefs.size === 0) state = 'REVIEW_RECOMMENDED';

  return {
    state,
    files_scanned: files.length,
    machine_count: findings.length,
    category_count: categories.length,
    categories,
    identity_references: [...identityRefs].sort(),
    signals,
    findings
  };
}

function normalizedHash(payload) {
  return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

function nextAction(state, identityCount) {
  if (state === 'REVIEW_RECOMMENDED') {
    return 'https://msp.ecocitizenz.com/audit?utm_source=github&utm_medium=action&utm_campaign=msp-machine-estate&utm_content=review-recommended';
  }
  if (state === 'MACHINE_ESTATE_OBSERVED' && identityCount === 0) {
    return 'https://msp.ecocitizenz.com/trust-check?utm_source=github&utm_medium=action&utm_campaign=msp-machine-estate&utm_content=identity-discovery';
  }
  return '';
}

function summaryMarkdown(report, nextUrl) {
  const categoryRows = report.categories.length
    ? report.categories.map((c) => `| ${c} | ${report.findings.filter((f) => f.category === c).length} |`).join('\n')
    : '| none observed | 0 |';
  const identityText = report.identity_references.length
    ? `${report.identity_references.length} reference(s) observed`
    : 'No ECZ-ID / Resolver reference observed — this is a neutral observation, not a safety verdict.';
  const next = nextUrl
    ? `\n### One next step\n\n${report.state === 'REVIEW_RECOMMENDED'
      ? 'Multiple machine/delegated surface categories were observed without an ECZ-ID identity reference. If this customer estate needs a human account of operators, authority and evidence, review the fixed-scope **£395 Client-Estate Machine Trust Baseline**.'
      : 'Machine surfaces were observed without an ECZ-ID identity reference. Start with the free MSP Machine Trust Check.'}\n\n${nextUrl}\n`
    : '';
  return `## ECZ-ID MSP Machine Estate Inventory\n\n**Result:** \`${report.state}\`  \n**Files scanned:** ${report.files_scanned}  \n**Observed surfaces:** ${report.machine_count}  \n**Identity evidence:** ${identityText}\n\n| Category | Observations |\n|---|---:|\n${categoryRows}\n\nThis Action inventories observable repository declarations. It does **not** certify, approve, secure, or declare a machine trustworthy. Missing ECZ-ID identity never means unsafe or non-compliant.${next}`;
}

function run(options = {}) {
  const workspace = path.resolve(options.workspace || process.env.GITHUB_WORKSPACE || process.cwd());
  const inspectPath = safeResolve(workspace, options.path || input('path', '.'));
  if (!fs.existsSync(inspectPath) || !fs.statSync(inspectPath).isDirectory()) {
    throw new Error('Inspection path does not exist or is not a directory.');
  }
  const outputPath = safeOutputPath(workspace, options.output || input('output', 'eczid-msp-machine-estate.json'));
  const clientId = options.clientId != null ? options.clientId : input('client-id', '');

  const result = inventory(inspectPath);
  const hashPayload = {
    schema_version: '1.0.0',
    client_id: clientId || null,
    root: path.relative(workspace, inspectPath).split(path.sep).join('/') || '.',
    categories: result.categories,
    identity_references: result.identity_references,
    signals: result.signals,
    findings: result.findings
  };
  const baselineHash = normalizedHash(hashPayload);
  const nextUrl = nextAction(result.state, result.identity_references.length);
  const report = {
    schema_version: '1.0.0',
    generated_at: new Date().toISOString(),
    client_id: clientId || null,
    root: hashPayload.root,
    result_state: result.state,
    baseline_hash: baselineHash,
    ...result,
    next_action_url: nextUrl,
    claims_boundary: 'Repository observations only. No safety, security, compliance, certification, approval, or endorsement verdict is produced.'
  };

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  return { report, outputPath, nextUrl };
}

function main() {
  const failOn = input('fail-on', 'invalid').toLowerCase();
  try {
    const { report, outputPath, nextUrl } = run();
    setOutput('result-state', report.result_state);
    setOutput('machine-count', report.machine_count);
    setOutput('category-count', report.category_count);
    setOutput('identity-reference-count', report.identity_references.length);
    setOutput('baseline-hash', report.baseline_hash);
    setOutput('report-path', path.relative(process.env.GITHUB_WORKSPACE || process.cwd(), outputPath).split(path.sep).join('/'));
    setOutput('next-action-url', nextUrl);
    appendSummary(summaryMarkdown(report, nextUrl));
    console.log(`ECZ-ID MSP Machine Estate Inventory: ${report.result_state}; ${report.machine_count} observations across ${report.category_count} categories.`);
  } catch (error) {
    setOutput('result-state', 'INVALID_INPUT');
    setOutput('machine-count', '0');
    setOutput('category-count', '0');
    setOutput('identity-reference-count', '0');
    setOutput('baseline-hash', '');
    setOutput('report-path', '');
    setOutput('next-action-url', '');
    appendSummary(`## ECZ-ID MSP Machine Estate Inventory\n\n**Result:** \`INVALID_INPUT\`\n\n${error.message}\n\nNo safety, security or compliance verdict was produced.`);
    console.error(`ECZ-ID MSP Machine Estate Inventory: ${error.message}`);
    if (failOn !== 'never') process.exitCode = 2;
  }
}

if (require.main === module) main();

module.exports = {
  inventory,
  normalizedHash,
  nextAction,
  run,
  safeResolve,
  safeOutputPath,
  summaryMarkdown
};
