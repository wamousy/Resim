import {spreadTSV,directedDies} from './tsv-display.js?v=19';
import {coreFrames,coreBounds,cropRect,clipPath,insideBounds} from './core-view.js?v=19';
import {separateLogicalRoutes} from './logical-routes.js?v=19';
import {connectionScope,SCOPE_COLORS,SCOPE_NAMES,logicalCaption,visibleConnection} from './connection-view.js?v=19';
import * as THREE from 'three';
import {OrbitControls} from '/static/vendor/OrbitControls.js';
import {sceneDimensions,fitPerspective,routeDraft,number as fmt,linkBudget,linkCaption,metalColorHex} from './layout-model.js?v=19';
const $=id=>document.getElementById(id);
const colors={compute:0x51c8c0,logic:0x69b9b9,control:0x56a8b8,dma:0x88cdb9,sram:0x8396ed,dram:0xc6a875};
const gradient=value=>new THREE.Color().setHSL((1-Math.min(1,Math.max(0,value)))*.48,.65,.55);
const metalColor=(name,metals)=>new THREE.Color(name?metalColorHex(name,metals):0x99e6df);
export class Viewer {
  constructor(actions){
    this.actions=actions;this.meshes=[];this.wireMeshes=[];this.portMeshes=[];this.tsvMeshes=[];this.coreMeshes=[];this.selectedLink=null;this.view='3d';this.scene=new THREE.Scene();
    this.renderer=new THREE.WebGLRenderer({antialias:true,alpha:true});this.renderer.setPixelRatio(Math.min(devicePixelRatio,2));$('canvas').appendChild(this.renderer.domElement);
    this.camera=new THREE.PerspectiveCamera(38,1,.001,2000);this.controls=new OrbitControls(this.camera,this.renderer.domElement);this.controls.enableDamping=true;this.controls.minDistance=.1;this.controls.maxDistance=1000;
    this.scene.add(new THREE.HemisphereLight(0xe4f3ff,0x566571,2.4));const light=new THREE.DirectionalLight(0xffffff,2.5);light.position.set(5,12,7);this.scene.add(light);this.root=new THREE.Group();this.scene.add(this.root);
    const resize=()=>{const box=$('canvas').getBoundingClientRect();if(!box.width||!box.height)return;const changed=this.lastWidth!==box.width||this.lastHeight!==box.height;this.lastWidth=box.width;this.lastHeight=box.height;this.renderer.setSize(box.width,box.height);this.camera.aspect=box.width/box.height;this.camera.updateProjectionMatrix();if(changed)this.reset();};new ResizeObserver(resize).observe($('canvas'));resize();
    this.renderer.setAnimationLoop(()=>{if($('page-layout').hidden||document.hidden)return;this.controls.update();this.renderer.render(this.scene,this.camera);});this.setupDragging();
  }
  setNavigation(mode){
    this.navigation=mode;const editing=mode==='edit';
    this.controls.mouseButtons.LEFT=editing?null:mode==='pan'?THREE.MOUSE.PAN:THREE.MOUSE.ROTATE;
    this.controls.enablePan=!editing;this.controls.enableRotate=!editing&&this.view!=='2d';
    $('nav-pan').classList.toggle('selected',mode==='pan');$('nav-rotate').classList.toggle('selected',mode==='rotate');
    this.renderer.domElement.style.cursor=editing?'crosshair':mode==='pan'?'grab':'';
    $('interaction-hint').textContent=editing?'拖动模块模式：左键移动模块，空白处不平移；点击“平移”退出模块编辑。':mode==='pan'?'平移模式：左键拖动视图，不改变模块坐标；滚轮缩放。':'旋转模式：左键旋转视图；滚轮缩放。';
  }
  clear(){this.root.traverse(o=>{o.geometry?.dispose();o.material?.map?.dispose();o.material?.dispose();});this.root.clear();this.meshes=[];this.wireMeshes=[];this.portMeshes=[];this.tsvMeshes=[];this.coreMeshes=[];}
  setView(mode,report,pending){this.view=mode;$('view3d').classList.toggle('selected',mode==='3d');$('view2d').classList.toggle('selected',mode==='2d');this.draw(report,pending);this.reset();}
  reset(){
    if(!this.report||!this.root.children.length)return;
    const box=new THREE.Box3().setFromObject(this.root),center=box.getCenter(new THREE.Vector3());
    // Fit all projected corners, including their perspective depth, so tall stacks do not clip.
    if(this.view==='2d')center.y=Math.max(...Object.values(this.origins))+.1;
    this.controls.target.copy(center);this.controls.enableRotate=this.view!=='2d';this.setNavigation($('edit-mode').checked?'edit':this.view==='2d'?'pan':this.navigation==='edit'?'rotate':this.navigation||'rotate');this.camera.up.set(0,1,0);
    const direction=(this.view==='2d'?new THREE.Vector3(0,1,.00001):new THREE.Vector3(1,.9,1.2)).normalize();
    const right=new THREE.Vector3().crossVectors(this.camera.up,direction).normalize(),up=new THREE.Vector3().crossVectors(direction,right).normalize();
    const points=[];
    for(const x of [box.min.x,box.max.x])for(const y of [box.min.y,box.max.y])for(const z of [box.min.z,box.max.z]){
      const v=new THREE.Vector3(x,y,z).sub(center);points.push([v.dot(right),v.dot(up),v.dot(direction)]);
    }
    const distance=fitPerspective(points,this.camera.aspect,this.camera.fov),offset=direction.multiplyScalar(distance);
    this.camera.position.copy(center).add(offset);this.camera.near=Math.max(.001,distance/10000);this.camera.far=Math.max(200,distance*10);this.camera.updateProjectionMatrix();this.camera.lookAt(center);this.controls.update();
  }
  label(text,x,y,z,size=.30,background=false,ink='#e9f3ff'){
    const lines=String(text).split('\n'),canvas=document.createElement('canvas');canvas.width=640;canvas.height=Math.max(80,lines.length*60+24);const c=canvas.getContext('2d');
    if(background){c.fillStyle='#102330';c.fillRect(8,4,624,canvas.height-8);c.strokeStyle='#e8ae71';c.lineWidth=3;c.strokeRect(8,4,624,canvas.height-8);}
    c.font='500 36px Segoe UI';c.fillStyle=ink;c.textAlign='center';lines.forEach((line,i)=>c.fillText(line,320,49+i*60,610));
    const sprite=new THREE.Sprite(new THREE.SpriteMaterial({map:new THREE.CanvasTexture(canvas),transparent:true,depthTest:false}));sprite.position.set(x,y,z);sprite.scale.set(size*6.4,size*canvas.height/100,1);sprite.renderOrder=background?30:0;this.root.add(sprite);
  }

  cube(w,h,d,x,y,z,color,opacity=1){const mesh=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),new THREE.MeshStandardMaterial({color,transparent:opacity<1,opacity,roughness:.6,metalness:.12}));mesh.position.set(x,y,z);this.root.add(mesh);return mesh;}
  line(points,color=0x99e6df){this.root.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(points),new THREE.LineBasicMaterial({color,transparent:true,opacity:.85,depthTest:false})));}
  wire(points,link,color){
    const selected=link.id===this.selectedLink,definition=this.linkDefinitions?.[link.id]||link,related=this.selectedModule&&(definition.source===this.selectedModule||definition.target===this.selectedModule),radius=(.004+Math.log2(1+linkBudget(link).wires)*(this.physical?.002:.0005))*(selected||related?1.8:1)*(this.core?1:.4);
    for(let i=1;i<points.length;i++){
      const direction=new THREE.Vector3().subVectors(points[i],points[i-1]),length=direction.length();if(!length)continue;
      const mesh=new THREE.Mesh(new THREE.CylinderGeometry(radius,radius,length,8),new THREE.MeshBasicMaterial({color:color,transparent:true,opacity:selected||related?1:(this.selectedModule||this.selectedLink)?.08:.55,depthTest:false}));
      mesh.position.copy(points[i]).add(points[i-1]).multiplyScalar(.5);mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),direction.normalize());mesh.renderOrder=selected?12:10;this.root.add(mesh);
      const target=new THREE.Mesh(new THREE.CylinderGeometry(Math.max(this.core?.025:.012,radius),Math.max(this.core?.025:.012,radius),length,8),new THREE.MeshBasicMaterial({transparent:true,opacity:0,depthWrite:false}));target.position.copy(mesh.position);target.quaternion.copy(mesh.quaternion);target.userData.link=link.id;this.wireMeshes.push(target);this.root.add(target);
    }
  }
  arrowHead(points,color,link){
    if(points.length<2)return;const direction=new THREE.Vector3().subVectors(points.at(-1),points.at(-2));if(!direction.length())return;
    const arrowSize=Math.min(direction.length()*.35,this.core?.10:.045);direction.normalize();const mesh=new THREE.Mesh(new THREE.ConeGeometry(arrowSize*.32,arrowSize,8),new THREE.MeshBasicMaterial({color,depthTest:false,transparent:true,opacity:(this.selectedModule&&link?.source!==this.selectedModule&&link?.target!==this.selectedModule)||(this.selectedLink&&link?.id!==this.selectedLink)?.08:1}));
    mesh.position.copy(points.at(-1)).addScaledVector(direction,-arrowSize/2);mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),direction);mesh.renderOrder=14;this.root.add(mesh);
  }
  draw(report,pending=false){
    if(!report)return;this.report=report;this.clear();const focusedCore=$('scene-scope').value==='core'?$('scene-core').value:null,external=Boolean(focusedCore&&$('show-external').checked),core=external?null:focusedCore,logicReport={...report,modules:report.modules.filter(m=>report.dies.find(d=>d.id===m.die)?.kind!=='dram')},bounds=coreBounds(logicReport,core);this.core=core;this.dimensions=sceneDimensions([{width_um:bounds.width,height_um:bounds.height}]);
    const overview=!focusedCore&&report.project.architecture.chip==='blx_scheme1';
    const scale=this.dimensions.scale,ox=(bounds.x+bounds.width/2)*scale,oz=(bounds.y+bounds.height/2)*scale,layer=$('layer').value,explode=Number($('explode').value)/100;
    const faceDown=new Set();for(const v of report.interfaces){if(v.orientation==='F2F')faceDown.add(v.upper_die);if(v.orientation==='B2B')faceDown.add(v.lower_die);}const faceOffset=(die,offset)=>this.view!=='2d'&&faceDown.has(die)?-offset-(report.dies.find(d=>d.id===die)?.thickness_um||0)*scale:offset;
    const physical=$('connection-view').value==='metal',byMetal=physical&&$('connection-color').value==='metal';this.physical=physical;
    const hasLinks=report.project.architecture.links.length>0;
    for(const id of ['connection-scope','connection-core','wires','wire-labels','show-external'])$(id).disabled=!hasLinks;
    $('ports').disabled=!report.ports.length;
    const diagnostics={util:report.modules.some(m=>m.cell_utilization!=null),power:report.modules.some(m=>m.power_density_W_mm2!=null),congestion:report.summary.peak_congestion!=null&&!pending};
    for(const option of $('overlay').options)option.disabled=option.value!=='kind'&&!diagnostics[option.value];
    if($('overlay').selectedOptions[0]?.disabled)$('overlay').value='kind';
    const overlay=$('overlay').value;
    $('diagnostic-status').textContent=hasLinks?'灰色选项表示缺少数据；线束占宽需要在金属视图中选中一条连接。':'当前只有接口预算，尚无逐模块连线；连线筛选、金属分配和拥塞诊断暂不可用。';
    const metalFilter=physical?$('metal-layer').value:'all',metals=report.project.resources.metals;
    const modules=Object.fromEntries(report.project.architecture.modules.map(m=>[m.id,m])),placements=Object.fromEntries(report.project.floorplan.placements.map(p=>[p.module,p]));
    const scope=l=>connectionScope(l,modules,placements),shown=l=>visibleConnection(l,scope(l),$('connection-scope').value,focusedCore||$('connection-core').value,modules)&&(!focusedCore||external||modules[l.source]?.core===modules[l.target]?.core);
    const wireColor=(l,name)=>byMetal?metalColor(name,metals):SCOPE_COLORS[scope(l)];
    for(const id of ['metal-layer','metal-explode','wire-envelope'])$(id).disabled=!physical||!hasLinks||(id==='wire-envelope'&&!this.selectedLink);
    $('connection-color').disabled=!physical||!hasLinks;$('metal-controls').hidden=!physical;
    this.linkDefinitions=Object.fromEntries(report.project.architecture.links.map(l=>[l.id,l]));
    $('connection-legend-title').textContent=byMetal?'金属层颜色':'连接归属颜色';
    $('connection-mode-note').textContent=physical?'分段金属层与线束预算；不是逐根详细布线。':'箭头表示 source → target，反向传输为另一条连接。逻辑线错开仅为示意，不改变实际线长；点击连线聚焦，金属视图查看实际分配。';
    const metalSpread=Number($('metal-explode').value)/100,metalStep=this.view==='2d'||!physical?0:.024+metalSpread*.22;
    $('metal-explode-value').textContent=Math.round(metalSpread*100)+'%';
    const metalHeight=name=>name?.length?Math.max(0,metals.findIndex(m=>m.name===name))*metalStep:0;
    const legend=$('metal-color-legend');legend.replaceChildren();
    for(const metal of (byMetal?metals.filter(m=>metalFilter==='all'||m.name===metalFilter):[])){
      const span=document.createElement('span'),swatch=document.createElement('i');swatch.style.background='#'+metalColor(metal.name,metals).getHexString();span.append(swatch,document.createTextNode(`${metal.name} · ${metal.direction==='HORIZONTAL'?'H':'V'}`));legend.append(span);
    }
    if(!byMetal)for(const key of Object.keys(SCOPE_COLORS)){const span=document.createElement('span'),swatch=document.createElement('i');swatch.style.background='#'+SCOPE_COLORS[key].toString(16).padStart(6,'0');span.append(swatch,document.createTextNode(SCOPE_NAMES[key]));legend.append(span);}
    $('explode-value').textContent=Math.round(explode*100)+'%';this.origins={};const visible=report.dies.filter(d=>layer==='all'||d.id===layer);
    for(const d of visible){
      const localFrame=coreFrames(report,d.id).find(f=>f.core===core);
      const surface=core&&d.kind!=='dram'&&localFrame?localFrame:core?cropRect({x_um:0,y_um:0,width_um:d.width_um,height_um:d.height_um},bounds):{x_um:0,y_um:0,width_um:d.width_um,height_um:d.height_um};if(!surface)continue;
      const sy=layer==='all'?d.z_um*scale+d.order*(explode*.85+Math.max(0,metals.length-1)*metalStep):0;this.origins[d.id]=sy;const thick=d.kind==='dram'?.025:d.thickness_um*scale;
      this.cube(surface.width_um*scale,thick,surface.height_um*scale,(surface.x_um+surface.width_um/2)*scale-ox,sy-thick/2,(surface.y_um+surface.height_um/2)*scale-oz,d.kind==='dram'?0x566274:overview?(d.id==='xdie'?0xe3ebe5:0xffdf83):0x427580,overview?.85:.30);
      this.line([[surface.x_um,surface.y_um],[surface.x_um+surface.width_um,surface.y_um],[surface.x_um+surface.width_um,surface.y_um+surface.height_um],[surface.x_um,surface.y_um+surface.height_um],[surface.x_um,surface.y_um]].map(([x,y])=>new THREE.Vector3(x*scale-ox,sy,y*scale-oz)),0x6ea9b0);
      if(!core&&d.kind!=='dram')this.label(`${d.id==='dram_8layers'?'DRAM (8 layers)':d.id} · ${fmt(d.width_um/1000)} × ${fmt(d.height_um/1000)} mm · ${fmt(d.area_mm2)} mm² · 正面${faceDown.has(d.id)?'↓':'↑'}${core?' · 局部查看':''}`,(surface.x_um+surface.width_um/2)*scale-ox,sy+.14,surface.y_um*scale-oz-.22,.20);
      if(core)this.label(d.kind==='dram'?'DRAM (8 layers)':`${d.id} · 核布局区 ${fmt(surface.width_um/1000)} × ${fmt(surface.height_um/1000)} mm · ${fmt(surface.width_um*surface.height_um/1e6)} mm²`,(surface.x_um+surface.width_um/2)*scale-ox,sy+.15,surface.y_um*scale-oz-.25,.24,true);
      if(d.id==='dram_8layers'){const rows=report.interfaces.filter(v=>v.upper_die===d.id&&(!core||v.region?.core===core)),signals=rows.reduce((n,v)=>n+v.signal_vias,0);this.label(`DRAM (8 layers)\n${rows.length?fmt(signals,0)+' bit TSV 接口预算':'存储平台'}`,(surface.x_um+surface.width_um/2)*scale-ox,sy+.24,(surface.y_um+surface.height_um/2)*scale-oz,.26,true);}
      for(const frame of (d.kind==='dram'?[]:coreFrames(report,d.id)).filter(f=>!core||f.core===core)){
        const x=frame.x_um,z=frame.y_um,w=frame.width_um,h=frame.height_um;
        if(overview){
          const tile=this.cube(w*scale,.055,h*scale,(x+w/2)*scale-ox,sy+.04,(z+h/2)*scale-oz,0x94aecb,.98);tile.userData.core=frame.core;this.coreMeshes.push(tile);
          if(d.id==='xdie'){const ioLeft=Number(frame.core.replace('core',''))<8,iw=w*.43,ix=ioLeft?x:x+w-iw;const io=this.cube(iw*scale,.025,h*scale,(ix+iw/2)*scale-ox,sy+.085,(z+h/2)*scale-oz,0x91cb48);io.userData.core=frame.core;this.coreMeshes.push(io);this.label('3 × UCIE',(ix+iw/2)*scale-ox,sy+.15,(z+h/2)*scale-oz,.11);}
          if(d.id==='bdie')for(const f of [.13,.37,.62,.87])this.line([new THREE.Vector3((x+80)*scale-ox,sy+.08,(z+h*f)*scale-oz),new THREE.Vector3((x+w-80)*scale-ox,sy+.08,(z+h*f)*scale-oz)],0xd7c8fa);
          this.label(frame.core,(x+w*(d.id==='xdie'?(Number(frame.core.replace('core',''))<8?.72:.28):.5))*scale-ox,sy+.16,(z+h*.5)*scale-oz,layer==='all'?.16:.23,false,'#203647');
        }else if(['bdie','ldie','xdie'].includes(d.id))this.cube(w*scale,.01,h*scale,(x+w/2)*scale-ox,sy+.008,(z+h/2)*scale-oz,d.id==='xdie'?0x46be95:0x4f8ce0,.22);
        this.line([[x,z],[x+w,z],[x+w,z+h],[x,z+h],[x,z]].map(([a,b])=>new THREE.Vector3(a*scale-ox,sy+.012,b*scale-oz)),0x8bb5c0);
        if(!core&&!overview)this.label(`${frame.core} · 布局区\n${fmt(w/1000)} × ${fmt(h/1000)} mm · ${fmt(w*h/1e6)} mm²`,(x+w/2)*scale-ox,sy+.14,(z+h)*scale-oz,core?.20:layer==='all'?.07:.105,Boolean(core)||layer!=='all');
      }
      if(core&&d.id==='bdie'&&localFrame){
        const rx=localFrame.x_um+120,rz=localFrame.y_um+120,sx=5060/6000,sz=6720/7689;
        for(const [x,z,w,h,c] of [[0,0,3600,938,0xc8e5cf],[3600,0,2400,938,0xffedb2],[0,1388,3600,522,0xc8e5cf],[0,3299,6000,411,0xffedb2],[0,3710,6000,1050,0xf1c7c7],[0,7121,6000,568,0xf1c7c7]])this.cube(w*sx*scale,.008,h*sz*scale,(rx+(x+w/2)*sx)*scale-ox,sy+faceOffset(d.id,.012),(rz+(z+h/2)*sz)*scale-oz,c,.45);
      }
      if(core&&report.project.architecture.chip==='blx_scheme1'){const io=report.modules.filter(m=>m.die===d.id&&m.core===core&&m.id.includes('iox_subsystem__UCIE'));if(io.length){const x=Math.min(...io.map(m=>m.x_um)),z=Math.min(...io.map(m=>m.y_um)),right=Math.max(...io.map(m=>m.x_um+m.width_um)),bottom=Math.max(...io.map(m=>m.y_um+m.height_um));this.line([[x-40,z-40],[right+40,z-40],[right+40,bottom+40],[x-40,bottom+40],[x-40,z-40]].map(([a,b])=>new THREE.Vector3(a*scale-ox,sy+.12,b*scale-oz)),0xffffff);this.label('iox_subsystem · 3 UCIE / 3 x2p',(x+right)/2*scale-ox,sy+.2,(bottom+80)*scale-oz,.18);}}
      if(overlay==='congestion'&&!pending){
        const map=metalFilter==='all'?report.congestion.find(x=>x.die===d.id):report.metal_routing?.layers.find(x=>x.die===d.id&&x.metal===metalFilter);
        if(map?.values)for(let iy=0;iy<map.size;iy++)for(let ix=0;ix<map.size;ix++){
          const v=map.capacity_tracks===0&&map.demand_values?.[iy][ix]>0?2:map.values[iy][ix];
          const cell=cropRect({x_um:ix*d.width_um/map.size,y_um:iy*d.height_um/map.size,width_um:d.width_um/map.size,height_um:d.height_um/map.size},bounds);
          if(cell&&v>.01)this.cube(cell.width_um*scale,.016,cell.height_um*scale,(cell.x_um+cell.width_um/2)*scale-ox,sy+.16,(cell.y_um+cell.height_um/2)*scale-oz,gradient(v),.7);
        }
      }
    }
    const origins=this.origins,maxPower=Math.max(.01,...report.modules.map(m=>m.power_density_W_mm2||0));
    for(const m of report.modules){
      if(overview&&!m.shared_cores?.length&&!m.id.includes('__edge_UCIE'))continue;
      if(core&&m.shared_cores?.length)continue;
      if(!(m.die in origins)||(core&&m.core!==core)||report.dies.find(d=>d.id===m.die)?.kind==='dram')continue;const color=overlay==='util'?(m.cell_utilization==null?0x78818c:gradient(m.cell_utilization)):overlay==='power'?(m.power_density_W_mm2==null?0x78818c:gradient(m.power_density_W_mm2/maxPower)):(m.kind==='io'?(m.die==='xdie'?0x538be8:0x48c88b):(['bdie','ldie','xdie'].includes(m.die)?(m.die==='xdie'?0x59b78c:0x709ce6):(colors[m.kind]||0x51c8c0)));
      const detailColor=core&&report.project.architecture.chip==='blx_scheme1'&&overlay==='kind'?(m.die==='xdie'?(m.id.includes('UCIE')?0x91cb48:/x2p|__io_sub|__comm_core|__sche_core/.test(m.id)?0xc7cbce:0xffedb2):m.id.includes('__MC')?0xc9bffc:/TC[0-3]|__scalar|__vector/.test(m.id)?0xf1c7c7:/vlink|rssram/.test(m.id)?0xc8e5cf:0xffedb2):color;
      const selected=m.id===this.selectedModule;const mesh=this.cube(m.width_um*scale,.10,m.height_um*scale,(m.x_um+m.width_um/2)*scale-ox,origins[m.die]+faceOffset(m.die,.06),(m.y_um+m.height_um/2)*scale-oz,selected?0x8affec:overview?0x91cb48:detailColor,this.selectedModule&&!selected?.25:overlay==='congestion'?.42:.92);if(selected){mesh.material.emissive.setHex(0x3cbda9);mesh.material.emissiveIntensity=.7;}mesh.userData.module=m;this.meshes.push(mesh);
      const halo=report.project.architecture.modules.find(def=>def.id===m.id)?.halo_um||0;
      if($('clearances').checked&&halo){const bounds=[[m.x_um-halo,m.y_um-halo],[m.x_um+m.width_um+halo,m.y_um-halo],[m.x_um+m.width_um+halo,m.y_um+m.height_um+halo],[m.x_um-halo,m.y_um+m.height_um+halo],[m.x_um-halo,m.y_um-halo]];this.line(bounds.map(([x,y])=>new THREE.Vector3(x*scale-ox,origins[m.die]+.02,y*scale-oz)),0xcbaaff);}
      const problem=report.issues.some(i=>i.severity==='error'&&i.subject.split(/\s*\/\s*|,\s*/).includes(m.id));
      if(m.id===this.selectedModule||problem){const border=new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry),new THREE.LineBasicMaterial({color:m.id===this.selectedModule?0xffffff:0xff806b,depthTest:false}));border.position.copy(mesh.position);border.renderOrder=15;this.root.add(border);}
      if((selected||overview||$('labels').checked)&&overlay!=='congestion')this.label(core?m.id.replace(m.core+'__','').replace('TC0','TCNW').replace('TC1','TCNE').replace('TC2','TCSW').replace('TC3','TCSE').replace('iox_subsystem__','').replace(/UCIE([0-2])/,'UCIE$1 · x32'):overview?m.id.split('__').at(-1):m.id,mesh.position.x,origins[m.die]+faceOffset(m.die,.2),mesh.position.z,selected?.42:Math.min(.42,m.width_um*scale/2),selected,(core||overview)&&report.project.architecture.chip==='blx_scheme1'&&!selected?'#203647':'#e9f3ff');
    }
    for(const b of report.blockages.map(r=>core?cropRect(r,bounds):r).filter(Boolean))if(b.die in origins)this.cube(b.width_um*scale,.06,b.height_um*scale,(b.x_um+b.width_um/2)*scale-ox,origins[b.die]+.04,(b.y_um+b.height_um/2)*scale-oz,0xd56f74,.5);
    if($('clearances').checked)for(const c of (report.project.constraints.routing_channels||[]).map(r=>core?cropRect(r,bounds):r).filter(Boolean))if(c.die in origins){this.cube(c.width_um*scale,.025,c.height_um*scale,(c.x_um+c.width_um/2)*scale-ox,origins[c.die]+.02,(c.y_um+c.height_um/2)*scale-oz,0x87c9ff,.24);if($('labels').checked)this.label('通道 '+c.id,(c.x_um+c.width_um/2)*scale-ox,origins[c.die]+.12,(c.y_um+c.height_um/2)*scale-oz,.18);}
    if($('tsv').checked)for(const v of report.interfaces){
      if(!v.region)continue;
      const lower=origins[v.lower_die],upper=origins[v.upper_die];if(lower==null&&upper==null)continue;
      const hb=v.interconnect==='HB',color=hb?0xa5d7ff:0xe59b60;
      if(hb){if(lower!=null&&upper!=null&&this.view!=='2d')this.label(`B ↔ L · F2F / HB 混合键合\n${core?'每核约 44.7 kbit':fmt(v.signal_vias,0)+' bit 整片 · 每核约 44.7 kbit'} · 不计独立预留面积`,(bounds.x+bounds.width/2)*scale-ox,(lower+upper)/2,(bounds.y+bounds.height)*scale-oz,.24,true);continue;}
      if(core&&v.region.core&&v.region.core!==core)continue;
      // Shared interface budgets are illustrated at each core without duplicating resource demand.
      const frames=!v.region.core&&report.project.architecture.chip==='blx_scheme1'?coreFrames(report,v.lower_die==='dram_8layers'?v.upper_die:v.lower_die).filter(f=>!core||f.core===core):[];
      if(overview&&!hb)continue;
      const regions=frames.length?frames.map(f=>({x_um:f.x_um+f.width_um*.86,y_um:f.y_um+f.height_um*.78,width_um:f.width_um*.08,height_um:f.height_um*.12})):(!core||v.region.core===core?[v.region]:[]);
      for(const r of regions){
        const bottom=lower??upper,top=upper??lower,height=Math.max(.08,top-bottom),cx=(r.x_um+r.width_um/2)*scale-ox,cz=(r.y_um+r.height_um/2)*scale-oz;
        const addPad=(y)=>{const pad=this.cube(r.width_um*scale,.035,r.height_um*scale,cx,y,cz,this.selectedTSV===v.id?0xffffff:color,.75);pad.userData.tsv=v.id;this.tsvMeshes.push(pad);};
        if(hb){
          // F2F bonding pads sit on facing surfaces; no through-silicon column.
          addPad(bottom+.12);if(upper!=null&&lower!=null)addPad(top+faceOffset(v.upper_die,.12));
        }else{
          const area=this.cube(r.width_um*scale,height,r.height_um*scale,cx,bottom+height/2,cz,this.selectedTSV===v.id?0xffffff:color,.28);area.userData.tsv=v.id;this.tsvMeshes.push(area);addPad(bottom);addPad(top);
        }
        if(core)this.label(hb?'HB · F2F\n面对面键合，无 TSV':`${v.region.core?v.region.core+(v.id.includes('__MC')?' / '+v.id.split('__')[1].split('_')[0]:'')+' 专有 · ':''}${v.upper_die} ↔ ${v.lower_die}\nTSV · ${fmt(v.signal_vias,0)} bit${v.orientation==='B2B'?' · 背对背':''}`,cx,bottom+height/2,cz,.20,true);
      }
      if(!core&&!v.region.core&&regions.length)this.label(`${v.upper_die} ↔ ${v.lower_die} · ${hb?'HB / F2F':'TSV'}\n整片预算 ${fmt(v.signal_vias,0)} bit · 重复接口示意`,(bounds.x+bounds.width)*scale-ox,(lower??upper)+.25,(bounds.y+bounds.height)*scale-oz,.22,true);
    }
    if($('ports').checked)for(const p of report.ports)if(p.die in origins&&(!core||p.core===core)){
      const color=p.feed==='stack_base'?0x93bbff:0xffbd78;
      const mesh=new THREE.Mesh(new THREE.OctahedronGeometry(.10),new THREE.MeshBasicMaterial({color,depthTest:false}));
      mesh.position.set(p.x_um*scale-ox,origins[p.die]+.16,p.y_um*scale-oz);mesh.renderOrder=18;mesh.userData.port=p.id;this.portMeshes.push(mesh);this.root.add(mesh);
      if(this.selectedPort===p.id){const ring=new THREE.Mesh(new THREE.TorusGeometry(.15,.018,6,20),new THREE.MeshBasicMaterial({color:0xffffff,depthTest:false}));ring.position.copy(mesh.position);ring.rotation.x=Math.PI/2;ring.renderOrder=19;this.root.add(ring);}
      this.line([new THREE.Vector3(mesh.position.x,origins[p.die],mesh.position.z),mesh.position],color);
    }
    if($('wires').checked){let paths=routeDraft(report.project);const links=Object.fromEntries(report.project.architecture.links.map(l=>[l.id,l])),tagged=new Set();
      if(!pending&&report.routes){paths.routes=report.routes;if(!report.links.some(l=>l.endpoints))paths.terminals=[];}
      if(physical&&!pending&&report.metal_routing)paths.routes=report.metal_routing.allocated_routes;
      if(physical&&$('wire-envelope').checked&&!pending){
        for(const s of report.wiring?.segments||[]){
          if(report.dies.find(d=>d.id===s.die)?.kind==='dram'||(core&&(!insideBounds(s.start,bounds)||!insideBounds(s.end,bounds)))||!shown(links[s.link])||s.link!==this.selectedLink||!(s.die in origins)||!s.bundle_width_um||(metalFilter!=='all'&&s.assigned_metal!==metalFilter))continue;
          const horizontal=s.direction==='HORIZONTAL',band=this.cube((horizontal?s.length_um:s.bundle_width_um)*scale,.012,(horizontal?s.bundle_width_um:s.length_um)*scale,(s.start[0]+s.end[0])/2*scale-ox,origins[s.die]+faceOffset(s.die,.17),(s.start[1]+s.end[1])/2*scale-oz,wireColor(links[s.link],s.assigned_metal),.35);
          band.material.depthTest=false;band.material.depthWrite=false;band.renderOrder=9;
          band.position.y+=(faceDown.has(s.die)?-1:1)*metalHeight(s.assigned_metal);
        }
      }
      for(const pair of paths.terminals||[])if(pair.link===this.selectedLink){
        for(const endpoint of [pair.source,pair.target])if(endpoint.die in origins&&(!core||insideBounds(endpoint.point,bounds))){
          const dot=new THREE.Mesh(new THREE.SphereGeometry(.045,12,8),new THREE.MeshBasicMaterial({color:0xffc689,depthTest:false}));
          dot.position.set(endpoint.point[0]*scale-ox,origins[endpoint.die]+.20,endpoint.point[1]*scale-oz);dot.renderOrder=15;this.root.add(dot);
        }
      }
      if(!physical){paths=spreadTSV(paths,report.project,1/scale);paths.routes=separateLogicalRoutes(paths.routes,1/scale);}
      const clipped=core?paths.routes.flatMap(r=>clipPath(r.points,bounds).map(points=>({...r,points}))):paths.routes;
      const routes=[...clipped].sort((a,b)=>Number(a.link===this.selectedLink)-Number(b.link===this.selectedLink));
      for(const r of routes)if(r.die in origins&&report.dies.find(d=>d.id===r.die)?.kind!=='dram'){
        if(physical&&!pending&&report.metal_routing&&metalFilter!=='all'&&r.assigned_metal!==metalFilter)continue;
        const link=links[r.link];if(!shown(link))continue;const points=r.points.map(p=>new THREE.Vector3(p[0]*scale-ox,origins[r.die]+faceOffset(r.die,.19+metalHeight(r.assigned_metal)),p[1]*scale-oz));this.wire(points,r.assigned_metal?{...link,data_wires:r.wires,control_wires:0,spare_fraction:0}:(!physical&&link.bus_width_bits?{...link,data_wires:link.bus_width_bits,control_wires:0,spare_fraction:0}:link),wireColor(link,r.assigned_metal));
        if(!physical){this.arrowHead(points,wireColor(link),link);if(points.length>2)this.arrowHead(points.slice(0,Math.ceil(points.length/2)),wireColor(link),link);}
        const tag=physical?r.link+'|'+r.assigned_metal:r.link;
        if(!tagged.has(tag)&&($('wire-labels').checked||r.link===this.selectedLink)){
          const longest=points.slice(1).map((p,i)=>({a:points[i],b:p,length:p.distanceTo(points[i])})).sort((a,b)=>b.length-a.length)[0];
          if(longest?.length){const middle=longest.a.clone().add(longest.b).multiplyScalar(.5),offset=new THREE.Vector3(-(longest.b.z-longest.a.z),0,longest.b.x-longest.a.x).normalize().multiplyScalar(.30);middle.add(offset);this.label(physical?`${r.assigned_metal||'未分配层'} · ${r.wires??linkBudget(link).wires} 根\n线宽 ${fmt(metals.find(m=>m.name===r.assigned_metal)?.width_um,5)} µm`:`${link.source.split('__').at(-1)} → ${link.target.split('__').at(-1)}\n${logicalCaption(link)}`,middle.x,middle.y+.15,middle.z,.30,true);tagged.add(tag);}
        }
      }
      const orders=Object.fromEntries(report.project.architecture.dies.map(d=>[d.id,d.order]));
      for(const v of paths.vertical){
        const link=links[v.link];if((core&&!insideBounds(v.point,bounds))||!shown(link))continue;
        const sequence=directedDies(v,link,placements,orders),color=byMetal?0xf1bc87:wireColor(link);
        const height=d=>{const route=paths.routes.find(r=>r.link===v.link&&r.die===d&&[r.points[0],r.points.at(-1)].some(p=>Math.hypot(p[0]-v.point[0],p[1]-v.point[1])<1e-6));return origins[d]+faceOffset(d,.19+metalHeight(route?.assigned_metal));};
        if(sequence.every(d=>d in origins)){
          const points=sequence.map(d=>new THREE.Vector3(v.point[0]*scale-ox,height(d),v.point[1]*scale-oz));this.wire(points,link,color);this.arrowHead(points,color,link);
          if(link.id===this.selectedLink){const mid=points[0].clone().add(points[1]).multiplyScalar(.5);this.label(`${sequence[0]} → ${sequence[1]}\n${sequence[0]===v.lower_die?'↑ 向上':'↓ 向下'} · TSV`,mid.x+.2,mid.y,mid.z,.23,true);}
        }else if(link.id===this.selectedLink){const d=sequence.find(d=>d in origins);if(d)this.label(`${sequence[0]===v.lower_die?'↑':'↓'} TSV · ${sequence[0]} → ${sequence[1]}`,v.point[0]*scale-ox,height(d)+.25,v.point[1]*scale-oz,.25,true);}
      }
    }
    $('scene-dimensions').textContent=(core?`${core} 局部布局区（非整片 die）： `:'整片尺寸： ')+visible.map(d=>{const f=core&&d.kind!=='dram'?coreFrames(report,d.id).find(f=>f.core===core):null;if(d.kind==='dram')return 'DRAM ×8：存储平台（不展示芯片面积）';return `${d.id}: ${fmt((f?.width_um??d.width_um)/1000)} × ${fmt((f?.height_um??d.height_um)/1000)} mm · ${fmt(f?f.width_um*f.height_um/1e6:d.area_mm2)} mm²${core&&d.kind==='dram'?'（整片 DRAM，图中为局部）':''}`;}).join('　 |　 ')+(report.dies.some(d=>d.id==='dram_8layers')?'。DRAM 为 8 层封装抽象，仅计算外部 TSV 接口；未评估内部层间布线。':'。DRAM 隐藏内部模块；资源预算保持不变。');
    const hasPower=report.modules.some(m=>m.power_density_W_mm2!=null);
    $('color-scale').textContent={kind:'亮青色：选中模块 · 高亮线：直接关联连接',util:'利用率 0 → 100% · 灰色：未知',power:hasPower?`功耗密度 0 → ${fmt(maxPower)} W/mm² · 灰色：未知`:'功耗数据缺失 · 灰色不代表低功耗',congestion:pending?'拥塞指标暂不可用':'拥塞需求/容量 0 → 1 及以上'}[overlay];
  }
  setupDragging(){
    const element=this.renderer.domElement,ray=new THREE.Raycaster(),mouse=new THREE.Vector2();let down,drag;
    const cast=event=>{const rect=element.getBoundingClientRect();mouse.set((event.clientX-rect.left)/rect.width*2-1,-(event.clientY-rect.top)/rect.height*2+1);ray.setFromCamera(mouse,this.camera);};
    element.addEventListener('pointerdown',event=>{
      if(event.button!==0)return;if(this.navigation==='edit'){event.stopImmediatePropagation();event.preventDefault();}down=[event.clientX,event.clientY];cast(event);if(ray.intersectObjects([...this.portMeshes,...this.tsvMeshes]).length)return;const hit=ray.intersectObjects(this.meshes)[0];if(!hit)return;
      if(this.navigation!=='edit'||!this.actions.editable())return;const m=hit.object.userData.module;this.actions.select(m.id);
      if(this.report.project.architecture.modules.find(x=>x.id===m.id).fixed){this.actions.error('该模块被固定，请先修改固定约束。');return;}
      const plane=new THREE.Plane(new THREE.Vector3(0,1,0),-hit.object.position.y),point=new THREE.Vector3();if(!ray.ray.intersectPlane(plane,point))return;
      event.stopImmediatePropagation();event.preventDefault();this.controls.enabled=false;element.setPointerCapture(event.pointerId);
      drag={id:m.id,die:m.die,plane,start:point.clone(),x:m.x_um,y:m.y_um,moved:false};element.style.cursor='grabbing';
    },true);
    element.addEventListener('pointermove',event=>{
      if(!drag)return;event.stopImmediatePropagation();cast(event);const point=new THREE.Vector3();if(!ray.ray.intersectPlane(drag.plane,point))return;
      const d=this.report.dies.find(d=>d.id===drag.die),m=this.report.modules.find(m=>m.id===drag.id),grid=Math.max(0,Number($('edit-grid').value)||0),snap=v=>grid?Math.round(v/grid)*grid:v;
      const x=Number(Math.max(0,Math.min(Math.max(0,d.width_um-m.width_um),snap(drag.x+(point.x-drag.start.x)/this.dimensions.scale))).toFixed(6));
      const y=Number(Math.max(0,Math.min(Math.max(0,d.height_um-m.height_um),snap(drag.y+(point.z-drag.start.z)/this.dimensions.scale))).toFixed(6));
      if(x===m.x_um&&y===m.y_um)return;if(!drag.moved){this.actions.start();drag.moved=true;}this.actions.move(drag.id,drag.die,x,y);
    },true);
    const finish=event=>{
      if(drag){event.stopImmediatePropagation();const changed=drag.moved;drag=null;down=null;this.controls.enabled=true;this.setNavigation($('edit-mode').checked?'edit':this.navigation);if(element.hasPointerCapture(event.pointerId))element.releasePointerCapture(event.pointerId);if(changed)this.actions.finish();return;}
      if(event.type==='pointercancel'){down=null;return;}
      if(!down||Math.hypot(event.clientX-down[0],event.clientY-down[1])>5)return;cast(event);const coreHit=ray.intersectObjects(this.coreMeshes)[0];if(coreHit){$('scene-scope').value='core';$('scene-core').value=coreHit.object.userData.core;$('scene-core').dispatchEvent(new Event('change'));return;}const port=ray.intersectObjects(this.portMeshes)[0];if(port){this.actions.selectPort(port.object.userData.port);return;}const tsv=ray.intersectObjects(this.tsvMeshes)[0];if(tsv){this.actions.selectTSV(tsv.object.userData.tsv);return;}const hit=ray.intersectObjects(this.meshes)[0]||ray.intersectObjects(this.wireMeshes)[0];this.actions.selectPort(null);if(hit){if(hit.object.userData.link)this.actions.selectLink(hit.object.userData.link);else this.actions.select(hit.object.userData.module.id);}else this.actions.select(null);
    };
    element.addEventListener('pointerup',finish,true);element.addEventListener('pointercancel',finish,true);
  }
}
