"""Self-contained plan inputs and a static, coordinate-faithful floorplan view."""
from copy import deepcopy
import hashlib
import html
from pathlib import Path

from .schema import dumps

INPUT_FILES={'architecture':'inputs/chip-architecture.yml','technology':'inputs/technology.yml'}


def save_inputs(project, folder):
    from resim_search_policy import yaml_data,yaml_text,decode_stack
    data=yaml_data(dumps(project));resources=data.pop('resources');data.pop('schema_version',None)
    folder=Path(folder);(folder/'inputs').mkdir(parents=True,exist_ok=True)
    (folder/INPUT_FILES['architecture']).write_text(yaml_text({'schema_version':'resim-architecture/1',**decode_stack(data)}),encoding='utf-8')
    (folder/INPUT_FILES['technology']).write_text(yaml_text({'schema_version':'resim-technology/1','resources':resources}),encoding='utf-8')


def input_snapshot(folder):
    from resim_search_policy import merge_inputs
    return merge_inputs(Path(folder))


def compact_report(report):
    data=deepcopy(report)
    data.pop('project',None)
    data['storage_format']='resim-report/2'
    data['input_files']=dict(INPUT_FILES)
    return data


def floorplan_svg(report):
    """Physical X/Y coordinates, separate die panels; SVG is not mask/GDS data."""
    p=report['project'];a=p['architecture'];f=p['floorplan'];esc=lambda s:html.escape(str(s),quote=True)
    dies=sorted(a['dies'],key=lambda d:d['order'],reverse=True)
    width=1280 if len(dies)>1 else 640;height=120+600*((len(dies)+1)//2 if len(dies)>1 else 1)
    title=report.get('storage',{}).get('run_name') or report['name']
    parts=[f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}" role="img">',
           f'<title>{esc(title)} · 布局规划</title>',
           '<style>text{font-family:Arial,"Microsoft YaHei",sans-serif;fill:#20344b}.heading{font-size:23px;font-weight:600}.note{font-size:12px;fill:#596e83}.module{stroke:#506986;stroke-width:1}.module:hover{stroke:#e35422;stroke-width:3}</style>',
           f'<rect width="{width}" height="{height}" fill="#f4f7fb"/>',
           f'<text x="28" y="38" class="heading">{esc(title)} · 各层布局</text>',
           '<text x="28" y="65" class="note">封装坐标俯视（X 向右、Y 向上）；各层独立缩放，不按正背面镜像。架构级规划，非 GDS 或详细布线。</text>',
           '<text x="28" y="86" class="note">彩色区域：模块类型　灰红虚线：禁布区　橙色虚线：TSV 预留区　HB：接口说明，不计占地。</text>']
    modules={m['id']:m for m in a['modules']};palette=['#b7d8ee','#c2dfc4','#f0d6ad','#d4c5e6','#f2c4c6','#b7dcdb']
    for i,die in enumerate(dies):
        ox=(i%2)*640 if len(dies)>1 else 0;oy=110+(i//2)*600
        parts.append(f'<g transform="translate({ox},{oy})"><rect x="14" y="0" width="612" height="576" rx="12" fill="white" stroke="#d9e2ec"/>')
        face={'up':'正面朝上','down':'正面朝下','unknown':'朝向待定'}.get(p.get('stack',{}).get('die_faces',{}).get(die['id'],'unknown'))
        parts.append(f'<text x="32" y="30" font-size="18" font-weight="600">{esc(die["id"])} · {esc(face)}</text>')
        if die.get('display_platform'):
            parts.extend([f'<rect x="54" y="125" width="528" height="280" rx="10" fill="#d9e5f1" stroke="#64809c"/>',
                          f'<text x="318" y="260" text-anchor="middle" font-size="26">DRAM ×{die.get("package_layers",1)}</text>',
                          '<text x="318" y="290" text-anchor="middle" class="note">存储平台抽象 · 不表示内部 die 面积</text>','</g>']);continue
        parts.append(f'<text x="32" y="52" class="note">{die["width_um"]/1000:g} × {die["height_um"]/1000:g} mm · {die["width_um"]*die["height_um"]/1e6:g} mm²</text>')
        placements=[r for r in f['placements'] if r['die']==die['id']]
        maxx=max([die['width_um']]+[r['x_um']+r['width_um'] for r in placements]);maxy=max([die['height_um']]+[r['y_um']+r['height_um'] for r in placements])
        scale=min(530/maxx,435/maxy);left=55;bottom=510
        def rect(r):
            return f'x="{left+r["x_um"]*scale:g}" y="{bottom-(r["y_um"]+r["height_um"])*scale:g}" width="{r["width_um"]*scale:g}" height="{r["height_um"]*scale:g}"'
        parts.append(f'<rect {rect(dict(x_um=0,y_um=0,width_um=die["width_um"],height_um=die["height_um"]))} fill="#f7f9fc" stroke="#50637a" stroke-width="2"/>')
        for r in placements:
            m=modules[r['module']];color=palette[int(hashlib.sha256(m['kind'].encode()).hexdigest()[:8],16)%len(palette)]
            label=f'{m["id"]} · {m["kind"]} · {m["core"]}';detail=f'{label}; X={r["x_um"]:g}, Y={r["y_um"]:g}, W={r["width_um"]:g}, H={r["height_um"]:g} µm'
            parts.append(f'<g data-module="{esc(m["id"])}"><title>{esc(detail)}</title><rect {rect(r)} fill="{color}" class="module"/>')
            if r['width_um']*scale>56 and r['height_um']*scale>18:
                x=left+(r['x_um']+r['width_um']/2)*scale;y=bottom-(r['y_um']+r['height_um']/2)*scale
                parts.append(f'<text x="{x:g}" y="{y:g}" text-anchor="middle" dominant-baseline="middle" font-size="10" textLength="{max(25,min(len(m["id"])*6,r["width_um"]*scale-8)):g}" lengthAdjust="spacingAndGlyphs">{esc(m["id"])}</text>')
            parts.append('</g>')
        for r in p['constraints'].get('blockages',[]):
            if r['die']==die['id']:parts.append(f'<rect {rect(r)} fill="#da8585" fill-opacity=".2" stroke="#aa5555" stroke-dasharray="4 3"><title>禁布区：{esc(r["id"])}</title></rect>')
        hb=[]
        for r in f.get('tsv_regions',[]):
            if die['id'] not in (r['lower_die'],r['upper_die']):continue
            if r.get('interconnect','TSV')=='HB':hb.append(r['id']);continue
            parts.append(f'<rect {rect(r)} fill="#ffdc93" fill-opacity=".3" stroke="#c18016" stroke-dasharray="4 3"><title>TSV：{esc(r["id"])}</title></rect>')
        parts.append(f'<text x="32" y="543" class="note">{len(placements)} 个模块'+(f' · HB 接口 {len(hb)} 处' if hb else '')+'</text></g>')
    return ''.join(parts)+'</svg>'
