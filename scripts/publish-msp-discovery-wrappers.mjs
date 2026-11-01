#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname=dirname(fileURLToPath(import.meta.url));
const root=resolve(__dirname,'..');
const OWNER='EcoCitizenz-Ltd';
const RELEASE_TAG='v1.0.0';
const MAJOR_TAG='v1';
const ENGINE_SHA='fedb5cb7633e7cf74c952291a7fbe302e5333af6';
const PACK_ROOT=join(root,'release','discovery-wrappers');
const PUBLIC_FILES=['ENGINE_SHA','LICENSE.txt','PRIVACY.md','README.md','SECURITY.md','SUPPORT.md','action.yml'];
const WRAPPERS=Object.freeze([
  {slug:'eczid-msp-ai-agent-estate',name:'ECZ-ID MSP AI & Agent Estate',description:'Inventory AI-agent, MCP, plugin and workflow authority surfaces for MSP-managed customer estates using neutral evidence.'},
  {slug:'eczid-msp-machine-estate-inventory',name:'ECZ-ID MSP Machine Estate Inventory',description:'Discover machine actors and machine-consumed surfaces in a customer repository and create a neutral MSP evidence inventory.'},
  {slug:'eczid-msp-evidence-qbr-pack',name:'ECZ-ID MSP Evidence & QBR Pack',description:'Create deterministic machine-trust evidence packs for MSP QBR, vCISO, insurance and regulatory review workflows.'},
  {slug:'eczid-msp-standard-drift',name:'ECZ-ID MSP Standard Drift',description:'Compare current machine-trust evidence with an MSP-approved baseline without making a universal trust or compliance verdict.'},
]);

const fail=(m)=>{throw new Error(m);};
function run(command,args,options={}) { const r=spawnSync(command,args,{cwd:options.cwd??root,encoding:'utf8',stdio:options.capture?['ignore','pipe','pipe']:'inherit',shell:false,env:process.env}); if(r.error) throw r.error; if(r.status!==0&&!options.allowFailure) fail(`${command} ${args.join(' ')} failed with exit code ${r.status}.${options.capture?`\n${r.stderr||r.stdout||''}`:''}`); return r; }
const capture=(c,a,o={})=>String(run(c,a,{...o,capture:true}).stdout??'').trim();
const files=(dir)=>readdirSync(dir).sort().filter((n)=>statSync(join(dir,n)).isFile());

function generateAndValidate() {
  run(process.execPath,[join(root,'scripts','validate-msp-discovery-wrappers.mjs')]);
  const packs=new Map();
  for(const w of WRAPPERS){ const dir=join(PACK_ROOT,w.slug); if(!existsSync(dir)) fail(`${w.slug}: pack missing.`); const actual=files(dir); if(JSON.stringify(actual)!==JSON.stringify(PUBLIC_FILES)) fail(`${w.slug}: pack shape mismatch.`); if(readFileSync(join(dir,'ENGINE_SHA'),'utf8').trim()!==ENGINE_SHA) fail(`${w.slug}: engine SHA mismatch.`); packs.set(w.slug,dir); }
  return packs;
}
function assertAdmin(){ run('gh',['--version']); run('git',['--version']); run('gh',['auth','status']); const role=capture('gh',['api',`user/memberships/orgs/${OWNER}`,'--jq','.role']); if(role!=='admin') fail(`GitHub CLI session is not an organization owner/admin for ${OWNER}.`); run('gh',['auth','setup-git']); }
function sourceSha(){ const dirty=capture('git',['status','--porcelain']); if(dirty) fail('Source checkout must be clean before publication.'); const sha=capture('git',['rev-parse','HEAD']); if(!/^[0-9a-f]{40}$/.test(sha)) fail('Could not determine source SHA.'); return sha; }
function repoState(fullName){ const r=run('gh',['api',`repos/${fullName}`,'--jq','{size:.size,visibility:.visibility,archived:.archived}'],{capture:true,allowFailure:true}); if(r.status!==0){ const e=String(r.stderr??''); if(/HTTP 404|Not Found/i.test(e)) return {exists:false}; fail(`Could not inspect ${fullName}: ${e||r.stdout}`);} return {exists:true,...JSON.parse(String(r.stdout))}; }
function prepare(w,pack,source,staging){ const dir=join(staging,w.slug); mkdirSync(dir,{recursive:true}); cpSync(pack,dir,{recursive:true}); run('git',['init','-b','main'],{cwd:dir}); run('git',['config','user.name','EcoCitizenz Release'],{cwd:dir}); run('git',['config','user.email','release@ecocitizenz.com'],{cwd:dir}); run('git',['add','--all'],{cwd:dir}); run('git',['commit','-m',`Release ${w.name} ${RELEASE_TAG}\n\nWrapper source: ${source}\nEngine: ${ENGINE_SHA}`],{cwd:dir}); run('git',['tag','-a',RELEASE_TAG,'-m',`${w.name} ${RELEASE_TAG}`],{cwd:dir}); run('git',['tag','-a',MAJOR_TAG,'-m',`${w.name} stable v1`],{cwd:dir}); return dir; }
function peeled(dir,tag){ const out=capture('git',['ls-remote','origin',`refs/tags/${tag}^{}`],{cwd:dir}); const sha=out.split(/\s+/,1)[0]??''; if(!/^[0-9a-f]{40}$/.test(sha)) fail(`Could not read peeled ${tag}.`); return sha; }
function verify(w,dir){ const fullName=`${OWNER}/${w.slug}`; const localCommit=capture('git',['rev-parse','HEAD'],{cwd:dir}); const localAction=capture('git',['hash-object','action.yml'],{cwd:dir}); const localEngine=capture('git',['hash-object','ENGINE_SHA'],{cwd:dir}); const remoteMain=capture('gh',['api',`repos/${fullName}/git/ref/heads/main`,'--jq','.object.sha']); if(remoteMain!==localCommit) fail(`${fullName}: main mismatch.`); if(peeled(dir,RELEASE_TAG)!==localCommit) fail(`${fullName}: ${RELEASE_TAG} mismatch.`); if(peeled(dir,MAJOR_TAG)!==localCommit) fail(`${fullName}: ${MAJOR_TAG} mismatch.`); const remoteAction=capture('gh',['api',`repos/${fullName}/contents/action.yml?ref=${MAJOR_TAG}`,'--jq','.sha']); if(remoteAction!==localAction) fail(`${fullName}: action.yml read-back mismatch.`); const remoteEngine=capture('gh',['api',`repos/${fullName}/contents/ENGINE_SHA?ref=${MAJOR_TAG}`,'--jq','.sha']); if(remoteEngine!==localEngine) fail(`${fullName}: ENGINE_SHA read-back mismatch.`); const release=capture('gh',['api',`repos/${fullName}/releases/tags/${RELEASE_TAG}`,'--jq','.tag_name']); if(release!==RELEASE_TAG) fail(`${fullName}: release read-back mismatch.`); return {fullName,releaseCommitSha:localCommit,actionBlobSha:localAction,engineBlobSha:localEngine,engineSha:ENGINE_SHA,readBackVerified:true}; }
function publish(w,dir,state,source){ const fullName=`${OWNER}/${w.slug}`; if(!state.exists) run('gh',['repo','create',fullName,'--public','--description',w.description]); run('git',['remote','add','origin',`https://github.com/${fullName}.git`],{cwd:dir}); run('git',['push','-u','origin','main'],{cwd:dir}); run('git',['push','origin',RELEASE_TAG,MAJOR_TAG],{cwd:dir}); run('gh',['release','create',RELEASE_TAG,'--repo',fullName,'--title',`${w.name} ${RELEASE_TAG}`,'--notes',`Initial ECZ-ID MSP Marketplace discovery wrapper. Wrapper source ${source}; immutable shared engine ${ENGINE_SHA}. Use @v1 for the stable wrapper channel or the full wrapper commit SHA where policy requires immutable third-party references.`]); return verify(w,dir); }
function plan(){ console.log(JSON.stringify({mode:'plan',owner:OWNER,release_tag:RELEASE_TAG,compatibility_tag:MAJOR_TAG,engine_sha:ENGINE_SHA,safety:{dry_run_by_default:true,validate_packs_flag:'--validate-packs',execute_flag_required:'--execute',refuses_non_empty_existing_repositories:true,exact_remote_readback_required:true,immutable_engine_pin_required:true},repositories:WRAPPERS.map(w=>`${OWNER}/${w.slug}`)},null,2)); }

const validateOnly=process.argv.includes('--validate-packs'); const execute=process.argv.includes('--execute');
if(validateOnly&&execute) fail('Choose --validate-packs or --execute, not both.');
if(validateOnly){ const packs=generateAndValidate(); console.log(JSON.stringify({ok:true,mode:'validate-packs',wrapper_count:packs.size,engine_sha:ENGINE_SHA})); process.exit(0); }
if(!execute){ plan(); process.exit(0); }
let staging;
try { process.chdir(root); assertAdmin(); const source=sourceSha(); const packs=generateAndValidate(); const states=new Map(); for(const w of WRAPPERS){const fullName=`${OWNER}/${w.slug}`; const s=repoState(fullName); if(s.exists&&(s.archived||s.visibility!=='public'||Number(s.size)!==0)) fail(`${fullName}: existing destination is not an empty public repository.`); states.set(w.slug,s);} staging=mkdtempSync(join(tmpdir(),'eczid-msp-wrappers-')); const prepared=new Map(); for(const w of WRAPPERS) prepared.set(w.slug,prepare(w,packs.get(w.slug),source,staging)); const published=[]; for(const w of WRAPPERS) published.push(publish(w,prepared.get(w.slug),states.get(w.slug),source)); console.log(JSON.stringify({ok:true,source_sha:source,engine_sha:ENGINE_SHA,published},null,2)); }
finally { if(staging) rmSync(staging,{recursive:true,force:true}); }
