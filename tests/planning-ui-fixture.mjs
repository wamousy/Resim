// Disposable real backend for browser QA. Create the printed stop_file to clean up.
import {spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {join,resolve,dirname,basename} from 'node:path';
import {tmpdir} from 'node:os';
import {createServer} from 'node:net';
import {fileURLToPath} from 'node:url';
import {readYaml} from '../_internal/resim/static/architecture-io.js';
const app=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const root=await mkdtemp(join(tmpdir(),'resim-planning-ui-'));
const stopFile=join(root,'stop-ui-fixture');
const probe=createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r));
const url='http://127.0.0.1:'+port;
const child=spawn(join(app,'Resim.Engine.exe'),['serve','--port',String(port),'--projects-dir',root],{windowsHide:true,stdio:'ignore'});
let done=false;
async function close(){
 if(done)return;done=true;
 if(child.exitCode===null){const exited=new Promise(r=>child.once('close',r));child.kill();await exited;}
 if(dirname(resolve(root))===resolve(tmpdir())&&basename(root).startsWith('resim-planning-ui-'))await rm(root,{recursive:true,force:true,maxRetries:10,retryDelay:100});
 process.exit(0);
}
try{
 for(let i=0;i<100;i++){try{if((await fetch(url+'/api/health')).ok)break;}catch{}await new Promise(r=>setTimeout(r,100));}
 const p=readYaml(await readFile(join(app,'..','ResimProjects','gcd16-nangate45','inputs','architecture.yml'),'utf8'));
 p.name='候选浏览验证（临时工程）';p.search={...p.search,candidates:12,time_limit_s:20};
 const r=await fetch(url+'/api/optimize',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({yaml:JSON.stringify(p),project_name:p.name})});
 if(!r.ok)throw new Error(await r.text());
 const result=await r.json();console.log(JSON.stringify({url,candidates:result.candidates.length,stop_file:stopFile}));
 process.stdin.resume();process.stdin.once('data',close);process.on('SIGTERM',close);
 setInterval(()=>{if(existsSync(stopFile))close();},500);setTimeout(close,600000);
}catch(e){console.error(e);await close();}
