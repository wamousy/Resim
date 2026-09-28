// Reproducible handover check: syntax, isolated tests, and file identity evidence.
import {spawnSync} from 'node:child_process';
import {readFileSync,readdirSync,existsSync,mkdirSync,writeFileSync} from 'node:fs';
import {resolve,dirname,join,relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const reportPath=resolve(root,process.argv[2]||'docs/verification.json');
const run=(args)=>spawnSync(process.execPath,args,{cwd:root,encoding:'utf8',windowsHide:true,maxBuffer:8*1024*1024});
const files=readdirSync(join(root,'_internal/resim/static')).filter(f=>f.endsWith('.js')).map(f=>'_internal/resim/static/'+f);
const syntax=files.map(file=>{const r=run(['--check',file]);return {file,passed:r.status===0,...(r.status===0?{}:{error:r.stderr||r.error?.message})};});
const tests=readdirSync(join(root,'tests')).filter(f=>f.endsWith('.test.mjs')).map(f=>'tests/'+f).sort();
const result=run(['--test','--test-reporter=tap',...tests]);
const output=(result.stdout||'')+(result.stderr||'');process.stdout.write(output);
const hash=file=>existsSync(join(root,file))?createHash('sha256').update(readFileSync(join(root,file))).digest('hex'):null;
const evidence={checked_at:new Date().toISOString(),platform:process.platform,node:process.version,
  engine_test_target:existsSync(join(root,'Resim.Engine.next.exe'))?'Resim.Engine.next.exe':'Resim.Engine.exe',
  files:Object.fromEntries(['Resim.exe','Resim.Engine.exe','Resim.Engine.next.exe','source/resim_search_policy.py'].map(f=>[f,hash(f)])),
  syntax,test_files:tests,test_exit_code:result.status,
  counts:Object.fromEntries(['tests','pass','fail','skipped'].map(k=>[k,Number(output.match(new RegExp('^# '+k+' (\\d+)','m'))?.[1]??0)])),
  passed:syntax.every(r=>r.passed)&&result.status===0};
mkdirSync(dirname(reportPath),{recursive:true});
writeFileSync(reportPath,JSON.stringify(evidence,null,2)+'\n');
writeFileSync(reportPath.replace(/\.json$/i,'')+'.tap',output);
console.log('Verification evidence: '+relative(root,reportPath));
process.exitCode=evidence.passed?0:1;
