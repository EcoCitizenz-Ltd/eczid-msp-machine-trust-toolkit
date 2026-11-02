#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const OWNER = "EcoCitizenz-Ltd";
const MAJOR_TAG = "v1";
const FIRST_RELEASE = "v1.0.0";
const PACK_ROOT = join(root, "release", "discovery-wrappers");

const WRAPPERS = Object.freeze([
  { slug: "eczid-msp-ai-agent-estate", name: "ECZ-ID MSP AI & Agent Estate" },
  { slug: "eczid-msp-machine-estate-inventory", name: "ECZ-ID MSP Machine Estate Inventory" },
  { slug: "eczid-msp-evidence-qbr-pack", name: "ECZ-ID MSP Evidence & QBR Pack" },
  { slug: "eczid-msp-standard-drift", name: "ECZ-ID MSP Standard Drift" }
]);

const MANAGED_FILES = Object.freeze([
  "ENGINE_SHA",
  "LICENSE.txt",
  "PRIVACY.md",
  "README.md",
  "SECURITY.md",
  "SUPPORT.md",
  "action.yml",
  "sbom.cdx.json"
]);
const MANAGED_SET = new Set(MANAGED_FILES);

function fail(message) {
  throw new Error(message);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? root,
    encoding: "utf8",
    stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit",
    shell: false,
    env: process.env
  });
  if (result.error) throw result.error;
  if (result.status !== 0 && !options.allowFailure) {
    const detail = options.capture ? `\n${result.stderr || result.stdout || ""}` : "";
    fail(`${command} ${args.join(" ")} failed with exit code ${result.status}.${detail}`);
  }
  return result;
}

function capture(command, args, options = {}) {
  return String(run(command, args, { ...options, capture: true }).stdout ?? "").trim();
}

function argValue(name) {
  const inline = process.argv.find((arg) => arg.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const index = process.argv.indexOf(name);
  if (index >= 0) return process.argv[index + 1] ?? "";
  return "";
}

function validateReleaseTag(tag) {
  const match = /^v1\.(\d+)\.(\d+)$/.exec(tag);
  if (!match) fail("--version must be an exact v1.x.y tag, for example v1.0.1 or v1.1.0.");
  if (tag === FIRST_RELEASE) fail(`${FIRST_RELEASE} is the already-published initial release; choose a later v1.x.y version.`);
  if (Number(match[1]) === 0 && Number(match[2]) === 0) fail("The next release must be later than v1.0.0.");
  return tag;
}

function files(dir) {
  return readdirSync(dir).sort().filter((name) => statSync(join(dir, name)).isFile());
}

function buildAndValidatePacks(releaseTag) {
  run(process.execPath, [join(root, "scripts", "build-msp-discovery-wrappers.mjs")]);
  // Preserve and prove the historical seven-file wrapper contract before adding the future-release SBOM layer.
  run(process.execPath, [join(root, "scripts", "validate-msp-discovery-wrappers.mjs")]);
  run(process.execPath, [join(root, "scripts", "generate-msp-wrapper-sboms.mjs"), "--version", releaseTag]);

  const packs = new Map();
  let commonEngineSha = null;
  for (const wrapper of WRAPPERS) {
    const dir = join(PACK_ROOT, wrapper.slug);
    if (!existsSync(dir)) fail(`${wrapper.slug}: generated pack is missing.`);
    const actual = files(dir);
    if (JSON.stringify(actual) !== JSON.stringify(MANAGED_FILES)) {
      fail(`${wrapper.slug}: future-release pack shape mismatch; got ${actual.join(", ")}.`);
    }
    const engineSha = readFileSync(join(dir, "ENGINE_SHA"), "utf8").trim();
    if (!/^[0-9a-f]{40}$/i.test(engineSha)) fail(`${wrapper.slug}: ENGINE_SHA is not an exact commit SHA.`);
    if (commonEngineSha && commonEngineSha !== engineSha) fail("MSP discovery wrappers do not share one exact engine SHA.");
    commonEngineSha = engineSha;
    const actionYaml = readFileSync(join(dir, "action.yml"), "utf8");
    if (!actionYaml.includes(`eczid-msp-machine-trust-toolkit@${engineSha}`)) {
      fail(`${wrapper.slug}: action.yml does not delegate to the exact ENGINE_SHA.`);
    }
    const sbomText = readFileSync(join(dir, "sbom.cdx.json"), "utf8");
    const sbom = JSON.parse(sbomText);
    if (sbom?.bomFormat !== "CycloneDX" || sbom?.specVersion !== "1.6") fail(`${wrapper.slug}: wrapper SBOM is not CycloneDX 1.6.`);
    if (sbom?.metadata?.component?.name !== wrapper.slug || sbom?.metadata?.component?.version !== releaseTag) {
      fail(`${wrapper.slug}: wrapper SBOM root metadata does not match the exact release.`);
    }
    if (sbom?.components?.[0]?.name !== `${OWNER}/eczid-msp-machine-trust-toolkit` || sbom?.components?.[0]?.version !== engineSha) {
      fail(`${wrapper.slug}: wrapper SBOM does not describe the exact shared-engine dependency.`);
    }
    packs.set(wrapper.slug, { dir, engineSha });
  }
  return { packs, engineSha: commonEngineSha };
}

function assertAdminSession() {
  run("gh", ["--version"]);
  run("git", ["--version"]);
  run("gh", ["auth", "status"]);
  const role = capture("gh", ["api", `user/memberships/orgs/${OWNER}`, "--jq", ".role"]);
  if (role !== "admin") fail(`GitHub CLI session is not an organization owner/admin for ${OWNER}.`);
  run("gh", ["auth", "setup-git"]);
}

function assertCleanSourceCheckout() {
  const status = capture("git", ["status", "--porcelain"]);
  if (status) fail("MSP toolkit source checkout must be clean before a release update.");
  const sourceSha = capture("git", ["rev-parse", "HEAD"]);
  if (!/^[0-9a-f]{40}$/i.test(sourceSha)) fail("Could not determine MSP wrapper source commit SHA.");
  return sourceSha;
}

function ghApiExists(path) {
  const result = run("gh", ["api", path], { capture: true, allowFailure: true });
  if (result.status === 0) return true;
  const detail = String(result.stderr || result.stdout || "");
  if (/HTTP 404|Not Found/i.test(detail)) return false;
  fail(`Could not preflight GitHub API path ${path}: ${detail}`);
}

function preflightDestinations(releaseTag) {
  for (const wrapper of WRAPPERS) {
    const fullName = `${OWNER}/${wrapper.slug}`;
    const state = JSON.parse(capture("gh", ["api", `repos/${fullName}`, "--jq", "{visibility:.visibility,archived:.archived,default_branch:.default_branch}"]));
    if (state.visibility !== "public" || state.archived || state.default_branch !== "main") {
      fail(`${fullName}: destination must be an active public repository with default branch main.`);
    }
    if (ghApiExists(`repos/${fullName}/git/ref/tags/${releaseTag}`)) fail(`${fullName}: ${releaseTag} already exists.`);
    if (ghApiExists(`repos/${fullName}/releases/tags/${releaseTag}`)) fail(`${fullName}: GitHub Release ${releaseTag} already exists.`);
    if (!ghApiExists(`repos/${fullName}/git/ref/tags/${MAJOR_TAG}`)) fail(`${fullName}: stable ${MAJOR_TAG} tag is missing.`);
  }
}

function changedPaths(dir) {
  const status = capture("git", ["status", "--porcelain"], { cwd: dir });
  if (!status) return [];
  return status.split(/\r?\n/).filter(Boolean).map((line) => {
    const raw = line.slice(3).trim();
    const path = raw.includes(" -> ") ? raw.split(" -> ").at(-1) : raw;
    return path.replace(/^"|"$/g, "").replaceAll("\\", "/");
  });
}

function prepareWrapper(wrapper, pack, sourceSha, releaseTag, stagingRoot) {
  const fullName = `${OWNER}/${wrapper.slug}`;
  const dir = join(stagingRoot, wrapper.slug);
  run("git", ["clone", "--no-tags", `https://github.com/${fullName}.git`, dir]);
  run("git", ["config", "user.name", "EcoCitizenz Release"], { cwd: dir });
  run("git", ["config", "user.email", "release@ecocitizenz.com"], { cwd: dir });
  if (capture("git", ["status", "--porcelain"], { cwd: dir })) fail(`${fullName}: checkout is unexpectedly dirty.`);

  for (const file of MANAGED_FILES) copyFileSync(join(pack.dir, file), join(dir, file));
  const changed = changedPaths(dir);
  if (!changed.length) fail(`${fullName}: generated wrapper pack is byte-identical to main; refusing an empty version release.`);
  const unexpected = changed.filter((path) => !MANAGED_SET.has(path));
  if (unexpected.length) fail(`${fullName}: update touched unmanaged public paths: ${unexpected.join(", ")}.`);

  run("git", ["add", "--", ...MANAGED_FILES], { cwd: dir });
  run("git", ["commit", "-m", `Release ${wrapper.name} ${releaseTag}\n\nWrapper source: ${sourceSha}\nEngine: ${pack.engineSha}`], { cwd: dir });
  const releaseCommit = capture("git", ["rev-parse", "HEAD"], { cwd: dir });
  run("git", ["tag", "-a", releaseTag, "-m", `${wrapper.name} ${releaseTag}`], { cwd: dir });
  return { wrapper, fullName, dir, releaseCommit, engineSha: pack.engineSha };
}

function remotePeeledTagCommit(dir, tag) {
  const output = capture("git", ["ls-remote", "origin", `refs/tags/${tag}^{}`], { cwd: dir });
  const sha = output.split(/\s+/, 1)[0] ?? "";
  if (!/^[0-9a-f]{40}$/i.test(sha)) fail(`Could not read back peeled remote tag ${tag}.`);
  return sha;
}

function verifyImmutableRelease(item, releaseTag) {
  const release = JSON.parse(capture("gh", [
    "api", `repos/${item.fullName}/releases/tags/${releaseTag}`,
    "--jq", "{tag_name:.tag_name,immutable:.immutable,draft:.draft,prerelease:.prerelease}"
  ]));
  if (release.tag_name !== releaseTag || release.draft || release.prerelease) {
    fail(`${item.fullName}: exact release read-back is not the expected published stable release.`);
  }
  if (release.immutable !== true) {
    fail(`${item.fullName}: ${releaseTag} is NOT immutable. Stable ${MAJOR_TAG} has NOT been moved. Do not bypass this gate.`);
  }
  run("gh", ["release", "verify", releaseTag, "--repo", item.fullName]);
  if (remotePeeledTagCommit(item.dir, releaseTag) !== item.releaseCommit) {
    fail(`${item.fullName}: ${releaseTag} does not peel to the prepared wrapper commit.`);
  }
}

function publishExactRelease(item, sourceSha, releaseTag) {
  run("git", ["push", "origin", "HEAD:main"], { cwd: item.dir });
  run("git", ["push", "origin", releaseTag], { cwd: item.dir });
  run("gh", [
    "release", "create", releaseTag,
    "--repo", item.fullName,
    "--verify-tag",
    "--title", `${item.wrapper.name} ${releaseTag}`,
    "--notes", `Certified ECZ-ID MSP discovery wrapper release. Wrapper source ${sourceSha}; exact shared engine ${item.engineSha}; CycloneDX wrapper SBOM records that exact runtime delegation. This exact version must verify as immutable before ${MAJOR_TAG} advances.`
  ]);
  verifyImmutableRelease(item, releaseTag);
}

function moveMajorTag(item, releaseTag) {
  run("git", ["tag", "-f", "-a", MAJOR_TAG, item.releaseCommit, "-m", `${item.wrapper.name} stable ${MAJOR_TAG} -> ${releaseTag}`], { cwd: item.dir });
  run("git", ["push", "--force", "origin", `refs/tags/${MAJOR_TAG}`], { cwd: item.dir });
  if (remotePeeledTagCommit(item.dir, MAJOR_TAG) !== item.releaseCommit) fail(`${item.fullName}: ${MAJOR_TAG} read-back mismatch.`);
  const localActionBlob = capture("git", ["hash-object", "action.yml"], { cwd: item.dir });
  const remoteActionBlob = capture("gh", ["api", `repos/${item.fullName}/contents/action.yml?ref=${MAJOR_TAG}`, "--jq", ".sha"]);
  if (remoteActionBlob !== localActionBlob) fail(`${item.fullName}: served ${MAJOR_TAG} action.yml does not match the verified wrapper commit.`);
  const engine = Buffer.from(capture("gh", ["api", `repos/${item.fullName}/contents/ENGINE_SHA?ref=${MAJOR_TAG}`, "--jq", ".content"]), "base64").toString("utf8").trim();
  if (engine !== item.engineSha) fail(`${item.fullName}: served ${MAJOR_TAG} ENGINE_SHA mismatch.`);
  const localSbomBlob = capture("git", ["hash-object", "sbom.cdx.json"], { cwd: item.dir });
  const remoteSbomBlob = capture("gh", ["api", `repos/${item.fullName}/contents/sbom.cdx.json?ref=${MAJOR_TAG}`, "--jq", ".sha"]);
  if (remoteSbomBlob !== localSbomBlob) fail(`${item.fullName}: served ${MAJOR_TAG} SBOM read-back mismatch.`);
}

function printPlan(releaseTag) {
  console.log(JSON.stringify({
    mode: "plan",
    owner: OWNER,
    exact_release_tag: releaseTag,
    compatibility_tag: MAJOR_TAG,
    wrapper_count: WRAPPERS.length,
    safety: {
      initial_publisher_unchanged: true,
      exact_version_release_first: true,
      exact_shared_engine_pin_required: true,
      wrapper_dependency_sbom_required: true,
      requires_owner_confirmation_release_immutability_enabled: true,
      requires_rest_immutable_true: true,
      requires_gh_release_verify: true,
      portfolio_exact_releases_verified_before_any_v1_move: true,
      v1_is_last_mutation: true,
      v1_has_no_github_release: true,
      managed_public_files_only: true,
      no_empty_version_release: true,
      external_consumer_smoke_required_after_v1_move: true
    },
    repositories: WRAPPERS.map((wrapper) => `${OWNER}/${wrapper.slug}`)
  }, null, 2));
}

const releaseTag = validateReleaseTag(argValue("--version"));
const execute = process.argv.includes("--execute");
const immutabilityConfirmed = process.argv.includes("--immutability-confirmed");

if (!execute) {
  printPlan(releaseTag);
  process.exit(0);
}
if (!immutabilityConfirmed) {
  fail("--execute requires --immutability-confirmed. An organization owner must enable GitHub release immutability for all four wrapper repositories before mutation.");
}

let stagingRoot;
try {
  process.chdir(root);
  assertAdminSession();
  const sourceSha = assertCleanSourceCheckout();
  const { packs, engineSha } = buildAndValidatePacks(releaseTag);
  preflightDestinations(releaseTag);

  stagingRoot = mkdtempSync(join(tmpdir(), "eczid-msp-next-release-"));
  const prepared = WRAPPERS.map((wrapper) => prepareWrapper(wrapper, packs.get(wrapper.slug), sourceSha, releaseTag, stagingRoot));

  // Certify the full exact-version portfolio before changing a single stable v1 consumer channel.
  for (const item of prepared) publishExactRelease(item, sourceSha, releaseTag);
  for (const item of prepared) moveMajorTag(item, releaseTag);

  console.log(JSON.stringify({
    ok: true,
    wrapper_source_sha: sourceSha,
    engine_sha: engineSha,
    exact_release_tag: releaseTag,
    compatibility_tag: MAJOR_TAG,
    exact_releases_immutable_verified: prepared.length,
    v1_channels_advanced: prepared.length,
    next_gate: "Run the separate external-consumer four-wrapper smoke and record read-back before closing the release cycle."
  }, null, 2));
} finally {
  if (stagingRoot) rmSync(stagingRoot, { recursive: true, force: true });
}
