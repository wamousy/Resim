// The packaged 0.1 engine has no die-face field. Keep explicit faces in a
// versioned description block; split architecture YAML exposes a normal stack key.
const marker=/\n?\[resim-stack\/1\]\n([\s\S]*?)\n\[\/resim-stack\]/;
export function readStack(project){
  const match=(project.architecture.description||'').match(marker);
  if(!match)return {die_faces:{}};
  try{return checkStack(JSON.parse(match[1]),project);}catch(e){throw new Error('堆叠配置无效：'+e.message);}
}
export const plainDescription=project=>(project.architecture.description||'').replace(marker,'').trim();
function checkStack(stack,project){
  if(!stack||typeof stack!=='object'||Array.isArray(stack)||Object.keys(stack).some(k=>k!=='die_faces'))throw new Error('stack 仅支持 die_faces');
  if(!stack.die_faces||typeof stack.die_faces!=='object'||Array.isArray(stack.die_faces))throw new Error('die_faces 必须为 Die ID 到 up/down/unknown 的映射');
  for(const [id,face] of Object.entries(stack.die_faces)){
    if(!project.architecture.dies.some(d=>d.id===id))throw new Error('Die 不存在：'+id);
    if(!['up','down','unknown'].includes(face))throw new Error(id+' 的正面朝向必须为 up/down/unknown');
  }
  return structuredClone(stack);
}
export function writeStack(project,stack){
  const next=structuredClone(project),value=checkStack(stack,next);
  next.architecture.description=plainDescription(next)+(Object.keys(value.die_faces).length?'\n[resim-stack/1]\n'+JSON.stringify(value)+'\n[/resim-stack]':'');
  return next;
}
export const faceText=value=>({up:'正面朝上',down:'正面朝下',unknown:'朝向待定',conflict:'朝向冲突'}[value]||'朝向待定');
export const surfaceOffset=(face,thickness,offset,view='3d')=>view==='3d'&&face==='down'?-thickness-offset:offset;
// Contact order is always lower die TOP, upper die BOTTOM.
export function contactOrientation(lowerFace,upperFace){
  if(!['up','down'].includes(lowerFace)||!['up','down'].includes(upperFace))return 'unspecified';
  return (lowerFace==='up'?'F':'B')+'2'+(upperFace==='down'?'F':'B');
}
export function stackModel(project){
  const explicit=readStack(project).die_faces,faces=new Map(),issues=[];
  const dies=[...project.architecture.dies].sort((a,b)=>a.order-b.order),regions=project.floorplan.tsv_regions||[];
  const issue=(severity,subject,reason,suggestion)=>issues.push({severity,subject,reason,suggestion,code:'STACK_GEOMETRY'});
  for(const d of dies){
    const claims=new Set();
    for(const r of regions){
      if(r.orientation==='F2F'){if(r.lower_die===d.id)claims.add('up');if(r.upper_die===d.id)claims.add('down');}
      if(r.orientation==='B2B'){if(r.lower_die===d.id)claims.add('down');if(r.upper_die===d.id)claims.add('up');}
    }
    const face=Object.hasOwn(explicit,d.id)?explicit[d.id]:(claims.size===1?[...claims][0]:claims.size>1?'conflict':'unknown');
    faces.set(d.id,{face,source:Object.hasOwn(explicit,d.id)?'输入指定':claims.size?'接口关系推断':'未指定'});
    if(face==='conflict')issue('error',d.id,'相邻接口对同一 Die 的朝向要求冲突','在架构输入中统一 Die 朝向及接口方式');
    if(face==='unknown'&&!d.display_platform)issue('unknown',d.id,'尚未指定正面朝向','在架构输入中选择正面朝上或朝下');
  }
  const pairs=[];
  for(let i=0;i<dies.length-1;i++){
    const lower=dies[i],upper=dies[i+1],group=regions.filter(r=>r.lower_die===lower.id&&r.upper_die===upper.id);
    const kinds=[...new Set(group.map(r=>r.interconnect||'TSV'))],orientation=contactOrientation(faces.get(lower.id).face,faces.get(upper.id).face);
    const pair={lower:lower.id,upper:upper.id,regions:group,orientation,kind:kinds.length===1?kinds[0]:kinds.length?'mixed':'undefined'};pairs.push(pair);
    if(!group.length)issue('unknown',lower.id+' ↔ '+upper.id,'层间接口未定义','导入含该相邻层接口区域及资源预算的芯片架构 YAML');
    if(group.some(r=>r.interconnect==='HB')&&orientation!=='F2F')issue(orientation==='unspecified'?'unknown':'error',lower.id+' ↔ '+upper.id,'当前直接 HB 模型需要两个正面相对；此配置为 '+orientation,'使用 F2F 朝向，或补充背面金属与穿硅路径模型后再评估其他 HB 结构');
    if(group.some(r=>['F2F','B2B'].includes(r.orientation)&&r.orientation!==orientation)&&orientation!=='unspecified')issue('error',lower.id+' ↔ '+upper.id,'接口的朝向标记与 Die 朝向不一致','应用结构时重新按 Die 朝向生成接口关系');
  }
  for(const r of regions)if(!pairs.some(p=>p.regions.includes(r)))issue('error',r.id,'接口端点不是按堆叠顺序排列的相邻层','检查 lower_die / upper_die 和 Die 顺序；跨多层连接须逐接口定义');
  return {dies,faces,pairs,issues};
}
export function applyStack(project,dieFaces,interfaceKinds=[]){
  let next=writeStack(project,{die_faces:dieFaces});
  for(const r of next.floorplan.tsv_regions||[]){
    const row=interfaceKinds.find(p=>p.lower===r.lower_die&&p.upper===r.upper_die);
    if(row&&row.kind!=='mixed')r.interconnect=row.kind;
    const relation=contactOrientation(dieFaces[r.lower_die],dieFaces[r.upper_die]);
    // Old engine enum supports F2F/B2B only; explicit faces retain F2B/B2F.
    r.orientation=['F2F','B2B'].includes(relation)?relation:'unspecified';
  }
  assertStack(next);return next;
}
export function assertStack(project){
  const errors=stackModel(project).issues.filter(i=>i.severity==='error');
  if(errors.length)throw new Error(errors.map(i=>i.subject+'：'+i.reason).join('；'));
  return project;
}
