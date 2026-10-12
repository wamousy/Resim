// Read-only comparison of frontend source and the built application.
import {readFileSync,readdirSync,existsSync,lstatSync} from 'node:fs';
import {resolve,dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'../../..');
const source=join(root,'src/frontend');
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
  for(let current=path;;current=dirname(current)) {
    if(!existsSync(current)||!lstatSync(current).isDirectory()||lstatSync(current).isSymbolicLink())
      throw new Error('Expected a local directory: '+current);
    if(current===root||dirname(current)===current)break;
  }
}
const hash=path=>createHash('sha256').update(readFileSync(path)).digest('hex');
export function checkWeb(runtime=target) {
  regularDirectory(source);regularDirectory(runtime);
  const inputs=files(source),outputs=files(runtime);
  if(!inputs.includes('index.html'))throw new Error('Frontend source is missing index.html');
  const inputSet=new Set(inputs),outputSet=new Set(outputs);
  const missing=inputs.filter(f=>!outputSet.has(f));
  const changed=inputs.filter(f=>outputSet.has(f)&&hash(join(source,f))!==hash(join(runtime,f)));
  const extra=outputs.filter(f=>!inputSet.has(f));
  return {passed:!missing.length&&!changed.length&&!extra.length,source_files:inputs.length,missing,changed,extra};
}
