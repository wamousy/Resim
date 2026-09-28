// Publish the editable frontend into the self-contained application package.
import {readFileSync,readdirSync,mkdirSync,copyFileSync,unlinkSync,existsSync,lstatSync} from 'node:fs';
import {resolve,dirname,join,relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const source=join(root,'src/web');
const target=join(root,'app/_internal/resim/static');
function files(folder,prefix='') {
  return readdirSync(folder,{withFileTypes:true}).flatMap(entry=>{
    if(entry.isSymbolicLink())throw new Error('Refusing linked frontend path: '+join(folder,entry.name));
    const name=prefix+entry.name;
    return entry.isDirectory()?files(join(folder,entry.name),name+'/'):[name];
  }).sort();
}
function regularDirectory(path) {
  // Do not follow a redirected app/static folder outside this checkout.
  for(let current=path;current!==root;current=dirname(current)) {
    if(!existsSync(current)||!lstatSync(current).isDirectory()||lstatSync(current).isSymbolicLink())
      throw new Error('Expected a local directory: '+current);
  }
}
const hash=path=>createHash('sha256').update(readFileSync(path)).digest('hex');
export function checkWeb() {
  regularDirectory(source);regularDirectory(target);
  const inputs=files(source),outputs=files(target);
  if(!inputs.includes('index.html'))throw new Error('Frontend source is missing index.html');
  const inputSet=new Set(inputs),outputSet=new Set(outputs);
  const missing=inputs.filter(f=>!outputSet.has(f));
  const changed=inputs.filter(f=>outputSet.has(f)&&hash(join(source,f))!==hash(join(target,f)));
  const extra=outputs.filter(f=>!inputSet.has(f));
  return {passed:!missing.length&&!changed.length&&!extra.length,source_files:inputs.length,missing,changed,extra};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const args=process.argv.slice(2);
  if(args.some(arg=>arg!=='--check'))throw new Error('Usage: node src/tools/sync-web.mjs [--check]');
  let result=checkWeb();
  if(!args.includes('--check')) {
    for(const file of [...result.missing,...result.changed]) {
      const destination=join(target,file);
      mkdirSync(dirname(destination),{recursive:true});
      copyFileSync(join(source,file),destination);
    }
    // Only remove stale generated frontend files, never project or runtime files.
    for(const file of result.extra)unlinkSync(join(target,file));
    result=checkWeb();
  }
  console.log(JSON.stringify({source:relative(root,source),target:relative(root,target),...result},null,2));
  process.exitCode=result.passed?0:1;
}
