import {load,dump,JSON_SCHEMA} from './vendor/js-yaml.mjs';

export function readYaml(text){
  if(!text.trim())throw new Error('YAML 内容为空');
  if(text.length>4_000_000)throw new Error('YAML 超过 4 MB');
  const value=load(text,{schema:JSON_SCHEMA});
  if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('YAML 顶层必须是对象');
  try{return JSON.parse(JSON.stringify(value));}catch{throw new Error('输入不能包含循环引用');}
}
export const writeYaml=value=>dump(value,{noRefs:true,lineWidth:110,sortKeys:false});
const allowed=(value,keys,label)=>{for(const key of Object.keys(value))if(!keys.includes(key))throw new Error(`${label} 不支持字段 ${key}`);};
export function architectureDocument(value){
  allowed(value,['schema_version','name','architecture','constraints','floorplan','search','resources'],'芯片架构文件');
  if(!['resim-architecture/1','resim/0.1',undefined].includes(value.schema_version))throw new Error('芯片架构文件版本不支持');
  if(!value.architecture||!value.name)throw new Error('芯片架构文件需要 name 和 architecture');
  const {resources,schema_version,...chip}=value;
  return structuredClone(chip);
}
export function technologyDocument(value){
  allowed(value,['schema_version','resources'],'工艺库文件');
  if(!['resim-technology/1',undefined].includes(value.schema_version))throw new Error('请选择工艺库 YAML（resim-technology/1）');
  if(!value.resources||typeof value.resources!=='object'||Array.isArray(value.resources))throw new Error('工艺库文件需要 resources');
  return structuredClone(value.resources);
}
export function mergeInputFiles(chipText,techText){
  const chip=readYaml(chipText),architecture=architectureDocument(chip);
  const resources=techText.trim()?technologyDocument(readYaml(techText)):chip.resources;
  if(!resources)throw new Error('请提供工艺库 YAML，或导入含 resources 的旧版完整输入');
  return {schema_version:'resim/0.1',...architecture,resources:structuredClone(resources)};
}
export function splitInputFiles(project){
  const {resources,schema_version,...chip}=structuredClone(project);
  return {chip:writeYaml({schema_version:'resim-architecture/1',...chip}),technology:writeYaml({schema_version:'resim-technology/1',resources})};
}
export function numeric(value,label,{nullable=false,min=0,positive=false,integer=false}={}){
  if(value===''||value==null){if(nullable)return null;throw new Error(label+' 不能为空');}
  const n=Number(value);if(!Number.isFinite(n)||n<min||(positive&&n<=0)||(integer&&!Number.isInteger(n)))throw new Error(label+' 的数值无效');
  return n;
}
export function updateModule(project,values,originalId=null){
  const next=structuredClone(project),a=next.architecture;
  const id=values.id.trim(),core=values.core.trim();
  if(!id||!core)throw new Error('模块 ID 和 Core ID 不能为空');
  if(originalId&&id!==originalId)throw new Error('已有模块 ID 不可直接改名，以保护连接引用');
  if(a.modules.some(m=>m.id===id&&m.id!==originalId))throw new Error('模块 ID 已存在');
  if(!a.dies.some(d=>d.id===values.die))throw new Error('请选择有效的所属 Die');
  const old=a.modules.find(m=>m.id===originalId),w=numeric(values.width,'模块宽度',{positive:true}),h=numeric(values.height,'模块高度',{positive:true});
  const cell=numeric(values.stdcell,'标准单元面积',{nullable:true}),macro=numeric(values.macro,'硬宏面积',{nullable:true});
  const utilization=numeric(values.utilization,'目标单元利用率',{positive:true});if(utilization>1)throw new Error('目标单元利用率不能超过 1');
  const m={...(old||{ports:['in','out'],port_locations:{},halo_um:0,shared_cores:[],voltage_domain:'VDD'}),id,core,kind:values.kind.trim()||'logic',allowed_dies:values.allowed.split(',').map(x=>x.trim()).filter(Boolean),width_um:w,height_um:h,stdcell_area_um2:cell??0,macro_area_um2:macro??0,area_known:cell!==null&&macro!==null,power_W:numeric(values.power,'模块功耗',{nullable:true}),target_cell_utilization:utilization,fixed:Boolean(values.fixed),provenance:values.provenance.trim()||'网页架构输入；未提供面积及功耗校准依据',metrics:{...(old?.metrics||{}),compute_TOPS:numeric(values.compute,'算力',{nullable:true}),bandwidth_GBps:numeric(values.bandwidth,'带宽需求',{nullable:true}),capacity_KiB:numeric(values.capacity,'容量需求',{nullable:true}),frequency_MHz:numeric(values.frequency,'频率',{nullable:true,positive:true}),bit_width:numeric(values.bitwidth,'计算位宽',{nullable:true,positive:true,integer:true}),precision:values.precision.trim()||'unspecified'}};
  if(!m.allowed_dies.length)m.allowed_dies=[values.die];
  if(!m.allowed_dies.includes(values.die))throw new Error('所属 Die 必须在允许分配的 Die 列表中');
  if(m.allowed_dies.some(id=>!a.dies.some(d=>d.id===id)))throw new Error('允许分配列表包含不存在的 Die');
  const i=a.modules.findIndex(m=>m.id===originalId);if(i<0)a.modules.push(m);else a.modules[i]=m;
  if(!a.cores.some(c=>c.id===core))a.cores.push({id:core,keep_on_same_die:false,metrics:{}});
  const placement={module:id,die:values.die,x_um:numeric(values.x,'模块 X'),y_um:numeric(values.y,'模块 Y'),width_um:w,height_um:h};
  const pi=next.floorplan.placements.findIndex(p=>p.module===id);if(pi<0)next.floorplan.placements.push(placement);else next.floorplan.placements[pi]={...next.floorplan.placements[pi],...placement};
  return next;
}
export function removeModule(project,id){
  if(project.architecture.modules.length<=1)throw new Error('至少保留一个模块');
  if(project.architecture.links.some(l=>l.source===id||l.target===id))throw new Error('请先移除或修改引用该模块的连接');
  const next=structuredClone(project);next.architecture.modules=next.architecture.modules.filter(m=>m.id!==id);next.floorplan.placements=next.floorplan.placements.filter(p=>p.module!==id);return next;
}
export function updateLink(project,v,originalId=null){
  const next=structuredClone(project),a=next.architecture,id=v.id.trim();
  if(!id)throw new Error('连接 ID 不能为空');
  if(originalId&&id!==originalId)throw new Error('已有连接 ID 不可直接改名');
  if(a.links.some(l=>l.id===id&&l.id!==originalId))throw new Error('连接 ID 已存在');
  if(!a.modules.some(m=>m.id===v.source)||!a.modules.some(m=>m.id===v.target))throw new Error('发送和接收模块必须存在');
  if(v.source===v.target)throw new Error('请选择不同的发送和接收模块');
  const old=a.links.find(l=>l.id===originalId),l={...(old||{}),id,source:v.source,target:v.target,source_port:v.sourcePort.trim()||'out',target_port:v.targetPort.trim()||'in',bus_width_bits:numeric(v.width,'逻辑位宽',{nullable:true,integer:true,positive:true}),bandwidth_GBps:numeric(v.bandwidth,'带宽'),lane_rate_Gbps:numeric(v.rate,'每线速率',{positive:true}),data_wires:numeric(v.wires,'物理数据线数',{nullable:true,positive:true,integer:true}),control_wires:numeric(v.control,'控制线数',{integer:true}),spare_fraction:numeric(v.spare,'冗余比例')};
  if(l.spare_fraction>1)throw new Error('冗余比例不能超过 1');
  const i=a.links.findIndex(l=>l.id===originalId);if(i<0)a.links.push(l);else a.links[i]=l;return next;
}
