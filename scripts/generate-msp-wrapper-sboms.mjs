#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const packRoot = join(root, "release", "discovery-wrappers");
const engineRepo = "EcoCitizenz-Ltd/eczid-msp-machine-trust-toolkit";
const wrappers = Object.freeze([
  "eczid-msp-ai-agent-estate",
  "eczid-msp-machine-estate-inventory",
  "eczid-msp-evidence-qbr-pack",
  "eczid-msp-standard-drift",
]);

function argValue(name) {
  const inline = process.argv.find((arg) => arg.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const index = process.argv.indexOf(name);
  if (index >= 0) return process.argv[index + 1] ?? "";
  return "";
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function validateVersion(value) {
  if (!/^v1\.\d+\.\d+$/.test(value)) throw new Error("--version must be an exact v1.x.y release tag.");
  return value;
}

const version = validateVersion(argValue("--version"));
for (const slug of wrappers) {
  const dir = join(packRoot, slug);
  const engineSha = readFileSync(join(dir, "ENGINE_SHA"), "utf8").trim();
  if (!/^[0-9a-f]{40}$/i.test(engineSha)) throw new Error(`${slug}: ENGINE_SHA is not an exact commit SHA.`);

  const actionText = readFileSync(join(dir, "action.yml"), "utf8");
  if (!actionText.includes(`${engineRepo}@${engineSha}`)) {
    throw new Error(`${slug}: action.yml does not delegate to the exact ENGINE_SHA.`);
  }

  const rootRef = `urn:eczid:github-action:${slug}:${encodeURIComponent(version)}`;
  const engineRef = `urn:eczid:github-action-engine:${engineSha}`;
  const sbom = {
    bomFormat: "CycloneDX",
    specVersion: "1.6",
    version: 1,
    metadata: {
      component: {
        type: "application",
        name: slug,
        version,
        "bom-ref": rootRef,
        hashes: [{ alg: "SHA-256", content: sha256(actionText) }],
        properties: [
          { name: "eczid:sbom-scope", value: "wrapper-runtime-delegation" },
          { name: "eczid:sbom-source", value: "action-yml-plus-engine-sha" },
        ],
      },
    },
    components: [
      {
        type: "application",
        name: engineRepo,
        version: engineSha,
        "bom-ref": engineRef,
        scope: "required",
        externalReferences: [
          { type: "vcs", url: `https://github.com/${engineRepo}/tree/${engineSha}` },
        ],
      },
    ],
    dependencies: [
      { ref: rootRef, dependsOn: [engineRef] },
      { ref: engineRef, dependsOn: [] },
    ],
  };

  const text = `${JSON.stringify(sbom, null, 2)}\n`;
  for (const forbidden of ["node_modules/.pnpm", "packages/core/src", "C:\\\\", "/home/"]) {
    if (text.includes(forbidden)) throw new Error(`${slug}: wrapper SBOM leaked private/build token ${forbidden}.`);
  }
  writeFileSync(join(dir, "sbom.cdx.json"), text);
  console.log(`[msp-wrapper-sbom] ${slug}@${version} engine=${engineSha} action_yml_sha256=${sbom.metadata.component.hashes[0].content}`);
}
