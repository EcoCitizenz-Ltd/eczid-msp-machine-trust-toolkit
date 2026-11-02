#!/usr/bin/env node
import { spawnSync } from 'node:child_process';

const OWNER = 'EcoCitizenz-Ltd';
const MSP_HOMEPAGE = 'https://msp.ecocitizenz.com/trust-check';

const REPOS = Object.freeze([
  {
    slug: 'eczid-msp-ai-agent-estate',
    description: 'Inventory AI-agent, MCP, plugin and workflow authority surfaces for MSP-managed customer estates using neutral evidence.',
    topics: ['github-actions','managed-service-provider','msp','ai-agents','mcp','agent-security','machine-identity','machine-trust','ecz-id'],
    homepage: MSP_HOMEPAGE
  },
  {
    slug: 'eczid-msp-machine-estate-inventory',
    description: 'Discover machine actors and machine-consumed surfaces in a customer repository and create a neutral MSP evidence inventory.',
    topics: ['github-actions','managed-service-provider','msp','asset-inventory','machine-identity','machine-trust','devsecops','ecz-id'],
    homepage: MSP_HOMEPAGE
  },
  {
    slug: 'eczid-msp-evidence-qbr-pack',
    description: 'Create deterministic machine-trust evidence packs for MSP QBR, vCISO, insurance and regulatory review workflows.',
    topics: ['github-actions','managed-service-provider','msp','vciso','qbr','cyber-insurance','compliance-evidence','machine-trust','ecz-id'],
    homepage: MSP_HOMEPAGE
  },
  {
    slug: 'eczid-msp-standard-drift',
    description: 'Compare current machine-trust evidence with an MSP-approved baseline without making a universal trust or compliance verdict.',
    topics: ['github-actions','managed-service-provider','msp','drift-detection','continuous-monitoring','configuration-management','machine-trust','devsecops','ecz-id'],
    homepage: MSP_HOMEPAGE
  },
]);

const fail = (message) => { throw new Error(message); };

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    stdio: options.capture ? ['ignore','pipe','pipe'] : 'inherit',
    shell: false,
    env: process.env
  });
  if (result.error) throw result.error;
  if (result.status !== 0 && !options.allowFailure) {
    fail(`${command} ${args.join(' ')} failed with exit code ${result.status}.${options.capture ? `\n${result.stderr || result.stdout || ''}` : ''}`);
  }
  return result;
}

const capture = (command, args, options = {}) => String(run(command, args, {...options, capture: true}).stdout ?? '').trim();

function validate() {
  if (REPOS.length !== 4) fail(`Expected four MSP wrapper repository configurations, got ${REPOS.length}.`);
  const seen = new Set();
  for (const repo of REPOS) {
    if (!/^eczid-msp-[a-z0-9-]+$/.test(repo.slug) || seen.has(repo.slug)) fail(`${repo.slug}: invalid/duplicate slug.`);
    seen.add(repo.slug);
    if (!repo.description || repo.description.length > 350) fail(`${repo.slug}: invalid description.`);
    if (repo.topics.length < 1 || repo.topics.length > 20 || new Set(repo.topics).size !== repo.topics.length) fail(`${repo.slug}: invalid topic set.`);
    for (const topic of repo.topics) if (!/^[a-z0-9-]{1,50}$/.test(topic)) fail(`${repo.slug}: invalid GitHub topic ${topic}.`);
    let homepage;
    try {
      homepage = new URL(repo.homepage);
    } catch {
      fail(`${repo.slug}: invalid homepage URL.`);
    }
    if (homepage.protocol !== 'https:' || !homepage.hostname) fail(`${repo.slug}: homepage must be an absolute HTTPS URL.`);
  }
}

function assertAdmin() {
  run('gh', ['--version']);
  run('gh', ['auth','status']);
  const role = capture('gh', ['api', `user/memberships/orgs/${OWNER}`, '--jq', '.role']);
  if (role !== 'admin') fail(`GitHub CLI session is not an organization owner/admin for ${OWNER}.`);
}

function read(fullName) {
  return JSON.parse(capture('gh', ['repo','view',fullName,'--json','visibility,description,repositoryTopics,homepageUrl']));
}

const topicNames = (repo) => (repo.repositoryTopics ?? []).map((entry) => String(entry.name)).sort();

function configure(repo) {
  const fullName = `${OWNER}/${repo.slug}`;
  const before = read(fullName);
  if (String(before.visibility).toUpperCase() !== 'PUBLIC') fail(`${fullName}: repository must already exist and be PUBLIC.`);

  const desired = [...repo.topics].sort();
  const current = topicNames(before);
  const desiredSet = new Set(desired);
  const currentSet = new Set(current);
  const args = ['repo','edit',fullName,'--description',repo.description,'--homepage',repo.homepage];
  for (const topic of current.filter((value) => !desiredSet.has(value))) args.push('--remove-topic', topic);
  for (const topic of desired.filter((value) => !currentSet.has(value))) args.push('--add-topic', topic);
  run('gh', args);

  const after = read(fullName);
  const actual = topicNames(after);
  if (after.description !== repo.description) fail(`${fullName}: repository description read-back mismatch.`);
  if (JSON.stringify(actual) !== JSON.stringify(desired)) fail(`${fullName}: repository topic read-back mismatch.`);
  if (after.homepageUrl !== repo.homepage) fail(`${fullName}: repository homepage read-back mismatch; expected=${repo.homepage}; actual=${after.homepageUrl ?? '<empty>'}.`);

  return {
    repository: fullName,
    description: repo.description,
    topics: desired,
    homepage: repo.homepage,
    read_back_verified: true
  };
}

function plan() {
  console.log(JSON.stringify({
    mode: 'plan',
    owner: OWNER,
    safety: {
      dry_run_by_default: true,
      execute_flag_required: '--execute',
      requires_existing_public_repositories: true,
      topic_limit_enforced: 20,
      exact_description_topic_and_homepage_readback_required: true,
      social_preview_is_separate_ui_step: true,
      marketplace_category_is_separate_ui_step: true
    },
    repositories: REPOS.map((repo) => ({
      repository: `${OWNER}/${repo.slug}`,
      description: repo.description,
      topics: repo.topics,
      homepage: repo.homepage
    }))
  }, null, 2));
}

validate();
const execute = process.argv.includes('--execute');
if (!execute) {
  plan();
  process.exit(0);
}
assertAdmin();
const configured = REPOS.map(configure);
console.log(JSON.stringify({
  ok: true,
  configured_count: configured.length,
  exact_readback_verified: configured.every((entry) => entry.read_back_verified),
  configured
}, null, 2));
