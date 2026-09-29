// Reproducible handover check: syntax, isolated tests, and file identity evidence.
import {spawnSync} from 'node:child_process';
import {readFileSync,readdirSync,existsSync,mkdirSync,mkdtempSync,writeFileSync} from 'node:fs';
import {resolve,dirname,join,relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import {checkWeb} from './sync-web.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const app=resolve(process.env.RESIM_APP_DIR||join(root,'app'));
const reportPath=resolve(root,process.argv[2]||'docs/verification.json');
mkdirSync(dirname(reportPath),{recursive:true});
const run=(args)=>spawnSync(process.execPath,args,{cwd:root,encoding:'utf8',windowsHide:true,maxBuffer:8*1024*1024});
const web=checkWeb(join(app,'_internal/resim/static'));
console.log('Frontend source/runtime match: '+web.passed+' ('+web.source_files+' files)');
const files=readdirSync(join(root,'src/frontend')).filter(f=>f.endsWith('.js')).map(f=>'src/frontend/'+f);
const syntax=files.map(file=>{const r=run(['--check',file]);return {file,passed:r.status===0,...(r.status===0?{}:{error:r.stderr||r.error?.message})};});
const tests=['frontend','integration'].flatMap(suite=>readdirSync(join(root,'src/tests',suite)).filter(f=>f.endsWith('.test.mjs')).map(f=>'src/tests/'+suite+'/'+f)).sort();
const result=run(['--test','--test-reporter=tap',...tests]);
const output=(result.stdout||'')+(result.stderr||'');process.stdout.write(output);
const localPython=join(root,'src/tools/.venv/Scripts/python.exe');
const junit=reportPath.replace(/\.json$/i,'')+'.backend.xml';
// A short, private base avoids shared pytest cache permissions and Windows MAX_PATH.
const testTemp=mkdtempSync(join(tmpdir(),'rv-'));
const python=spawnSync(process.env.RESIM_PYTHON||(existsSync(localPython)?localPython:'python'),['-m','pytest','-c','src/backend/pyproject.toml','-p','no:cacheprovider','--basetemp',join(testTemp,'p'),'--tb=short','-q','--junitxml',junit],{cwd:root,encoding:'utf8',windowsHide:true,maxBuffer:4*1024*1024,env:{...process.env,PYTHONUTF8:'1'}});
const pythonOutput=(python.stdout||'')+(python.stderr||'')+(python.error?.message||'');process.stdout.write(pythonOutput);
const hash=file=>existsSync(join(root,file))?createHash('sha256').update(readFileSync(join(root,file))).digest('hex'):null;
const manifestPath=join(app,'build-manifest.json');
const manifest=existsSync(manifestPath)?JSON.parse(readFileSync(manifestPath,'utf8')):null;
const stale=manifest?Object.entries(manifest.files).filter(([file,expected])=>hash(file)!==expected).map(([file])=>file):[];
const build={manifest_present:!!manifest,source_matches:!!manifest&&!stale.length,stale};
const xml=existsSync(junit)?readFileSync(junit,'utf8'):'';
const backend=Object.fromEntries(['tests','failures','errors','skipped'].map(k=>[k,Number(xml.match(new RegExp('\\b'+k+'="(\\d+)"'))?.[1]||0)]));
const backendFiles=[...readdirSync(join(root,'src/backend')).filter(f=>f.endsWith('.py')).map(f=>'src/backend/'+f),...readdirSync(join(root,'src/backend/resim')).filter(f=>f.endsWith('.py')).map(f=>'src/backend/resim/'+f),'src/backend/desktop/ResimHost.cs'];
const evidence={checked_at:new Date().toISOString(),platform:process.platform,node:process.version,
  application:app,
  host_test_target:process.env.RESIM_HOST_EXE||join(app,existsSync(join(app,'Resim.Host.test.exe'))?'Resim.Host.test.exe':'Resim.exe'),
  engine_test_target:join(app,existsSync(join(app,'Resim.Engine.next.exe'))?'Resim.Engine.next.exe':'Resim.Engine.exe'),
  files:Object.fromEntries([...['Resim.exe','Resim.Engine.exe'].map(f=>relative(root,join(app,f))),...backendFiles].map(f=>[f,hash(f)])),
  build,web,syntax,test_files:tests,test_exit_code:result.status,
  counts:Object.fromEntries(['tests','pass','fail','skipped'].map(k=>[k,Number(output.match(new RegExp('^# '+k+' (\\d+)','m'))?.[1]??0)])),
  python:{exit_code:python.status,...backend},
  passed:build.source_matches&&web.passed&&syntax.every(r=>r.passed)&&result.status===0&&python.status===0&&backend.tests>0};
mkdirSync(dirname(reportPath),{recursive:true});
writeFileSync(reportPath,JSON.stringify(evidence,null,2)+'\n');
writeFileSync(reportPath.replace(/\.json$/i,'')+'.tap',output);
writeFileSync(reportPath.replace(/\.json$/i,'')+'.python.txt',pythonOutput);
console.log('Verification evidence: '+relative(root,reportPath));
process.exitCode=evidence.passed?0:1;
