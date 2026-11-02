#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const ENGINE_SHA = 'fedb5cb7633e7cf74c952291a7fbe302e5333af6';
const ENGINE = 'EcoCitizenz-Ltd/eczid-msp-machine-trust-toolkit';
const releaseRoot = join(root, 'release', 'discovery-wrappers');
const PUBLIC_FILES = ['ENGINE_SHA','LICENSE.txt','PRIVACY.md','README.md','SECURITY.md','SUPPORT.md','action.yml'];

const expected = Object.freeze({
  'eczid-msp-ai-agent-estate': { target:`${ENGINE}/actions/ai-agent-estate@${ENGINE_SHA}`, inputs:['path','client-id','output','fail-on'], outputs:['result-state','surface-count','identity-reference-count','report-path','next-action-url'] },
  'eczid-msp-machine-estate-inventory': { target:`${ENGINE}@${ENGINE_SHA}`, inputs:['path','client-id','output','fail-on'], outputs:['result-state','machine-count','category-count','identity-reference-count','baseline-hash','report-path','next-action-url'] },
  'eczid-msp-evidence-qbr-pack': { target:`${ENGINE}/actions/evidence-qbr-pack@${ENGINE_SHA}`, inputs:['path','client-id','profile','output-json','output-markdown','fail-on'], outputs:['result-state','evidence-hash','observed-count','not-observed-count','json-path','markdown-path','next-action-url'] },
  'eczid-msp-standard-drift': { target:`${ENGINE}/actions/standard-drift@${ENGINE_SHA}`, inputs:['path','client-id','baseline','output','mode','fail-on'], outputs:['result-state','current-hash','expected-hash','changed-field-count','report-path','next-action-url'] },
});
const fail=(m)=>{throw new Error(m);};
const files=(dir)=>readdirSync(dir).sort().filter((n)=>statSync(join(dir,n)).isFile());
const mustContain=(text,token,label)=>{if(!text.includes(token))fail(`${label}: missing required token: ${token}`);};
const expr=(scope,name)=>`\${{ ${scope}['${name}'] }}`;

execFileSync(process.execPath,[join(root,'scripts','build-msp-discovery-wrappers.mjs')],{cwd:root,stdio:'inherit'});
if(!existsSync(releaseRoot))fail('release/discovery-wrappers was not generated.');
const dirs=readdirSync(releaseRoot).sort().filter((n)=>statSync(join(releaseRoot,n)).isDirectory());
const expectedDirs=Object.keys(expected).sort();
if(JSON.stringify(dirs)!==JSON.stringify(expectedDirs))fail(`wrapper directory set mismatch; expected=${expectedDirs.join(',')} actual=${dirs.join(',')}`);

for(const [slug,spec] of Object.entries(expected)){
  const dir=join(releaseRoot,slug),actualFiles=files(dir);
  if(JSON.stringify(actualFiles)!==JSON.stringify(PUBLIC_FILES))fail(`${slug}: public wrapper pack shape mismatch; expected=${PUBLIC_FILES.join(',')} actual=${actualFiles.join(',')}`);
  const engineSha=readFileSync(join(dir,'ENGINE_SHA'),'utf8').trim(); if(engineSha!==ENGINE_SHA||!/^[0-9a-f]{40}$/.test(engineSha))fail(`${slug}: invalid immutable engine SHA.`);
  const action=readFileSync(join(dir,'action.yml'),'utf8'),readme=readFileSync(join(dir,'README.md'),'utf8'),privacy=readFileSync(join(dir,'PRIVACY.md'),'utf8'),security=readFileSync(join(dir,'SECURITY.md'),'utf8'),support=readFileSync(join(dir,'SUPPORT.md'),'utf8'),license=readFileSync(join(dir,'LICENSE.txt'),'utf8');
  mustContain(action,'using: composite',slug);mustContain(action,spec.target,slug);mustContain(action,'id: delegate',slug);
  if(/@(?:main|master|v\d+)\b/i.test(action))fail(`${slug}: mutable engine reference found in wrapper action.yml.`);
  if((action.match(/\n\s*uses:/g)??[]).length!==1)fail(`${slug}: wrapper must delegate through exactly one uses step.`);
  for(const input of spec.inputs){mustContain(action,`  ${input}:`,`${slug} input`);mustContain(action,`${input}: ${expr('inputs',input)}`,`${slug} delegate input`);}
  for(const output of spec.outputs){mustContain(action,`  ${output}:`,`${slug} output`);mustContain(action,`value: ${expr('steps.delegate.outputs',output)}`,`${slug} delegate output`);}
  if(/\$\{\{\s*(?:inputs|steps\.delegate\.outputs)\.[^}]*-[^}]*\}\}/.test(action))fail(`${slug}: hyphenated expression uses unsafe dot notation.`);

  for(const phrase of [
    'Start without an ECZ-ID account or API key.',
    'GitHub Actions runner usage follows your GitHub plan.',
    '## Run it now',
    'workflow_dispatch:',
    'permissions:',
    '  contents: read',
    'uses: actions/checkout@v7',
    `uses: EcoCitizenz-Ltd/${slug}@v1`,
    '### First-run path',
    '## Minimal Action step',
    `utm_source=github&utm_medium=action-readme&utm_campaign=msp-machine-trust&utm_content=${slug}`,
    'No repository source upload to ECZ-ID.',
    'No hidden telemetry.',
    'Missing ECZ-ID identity is neutral',
    'No pay-to-pass.',
    'Local MSP/customer policy decides',
    `Delegates to \`${spec.target}\``
  ]) mustContain(readme,phrase,`${slug} README`);
  mustContain(readme,'@v1',`${slug} README version guidance`);mustContain(readme,'full release commit SHA',`${slug} README immutable guidance`);
  if(slug==='eczid-msp-standard-drift')mustContain(readme,'mode: propose',`${slug} first-run baseline proposal`);
  if(/repo=|customer=|ecz_id=/i.test(readme))fail(`${slug}: unbounded attribution identifier found in README.`);
  mustContain(privacy,'not uploaded to ECZ-ID',`${slug} privacy`);mustContain(privacy,'no hidden telemetry',`${slug} privacy`);mustContain(security,'full immutable commit SHA',`${slug} security`);mustContain(security,'Local MSP/customer policy decides',`${slug} security`);mustContain(support,'customer-private evidence',`${slug} support`);mustContain(license,'All rights reserved',`${slug} license`);
  const publicText=[action,readme,privacy,security,support,license].join('\n'); if(/£|\$\d|monthly|yearly|per month|per year/i.test(publicText))fail(`${slug}: mutable price/cadence copy escaped into public wrapper pack.`); for(const forbidden of ['BEGIN PRIVATE KEY','node_modules/','ECZID_DEV_SEAM'])if(publicText.includes(forbidden))fail(`${slug}: forbidden material detected: ${forbidden}`);
}
console.log(JSON.stringify({ok:true,engine_sha:ENGINE_SHA,wrapper_count:expectedDirs.length,public_files_per_wrapper:PUBLIC_FILES.length,wrappers:expectedDirs}));
