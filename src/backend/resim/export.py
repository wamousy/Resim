import html
import json
from pathlib import Path
from .schema import dumps


def save_report(report, output, *, compact=False):
    output = Path(output)
    output.mkdir(parents=True, exist_ok=True)
    stored=report
    if compact:
        from .plan_files import compact_report,save_inputs,floorplan_svg
        save_inputs(report['project'],output)
        stored=compact_report(report)
        (output/'floorplan.svg').write_text(floorplan_svg(report),encoding='utf-8')
    else:
        (output/'layout-plan.yml').write_text(dumps(report['project']),encoding='utf-8')
    (output/'resource-report.json').write_text(json.dumps(stored,ensure_ascii=False,indent=2),encoding='utf-8')
    from .feasibility import summarize
    assessment=summarize(report)
    if not compact:(output/'implementation-difficulties.json').write_text(json.dumps(assessment,ensure_ascii=False,indent=2),encoding='utf-8')
    lines=['# 实现难点评估', '', assessment['scope'], '', '状态：'+assessment['status'], '']
    names={'error':'约束违例','warning':'风险提示','unknown':'待补数据'}
    for group in assessment['groups']:
        lines.extend(['## '+names.get(group['severity'],group['severity'])+' · '+group['code']+'（'+str(group['count'])+'项）', '', '受影响对象：'+ '、'.join(group['subjects']), '', '原因：'+'；'.join(group['reasons']), '', '建议：'+'；'.join(group['suggestions']), ''])
    if not assessment['groups']:lines.append('在当前输入和模型范围内未发现问题；不等于已通过物理签核。')
    (output/'implementation-difficulties.md').write_text('\n'.join(lines),encoding='utf-8')
    manifest=dict(schema_version='resim-output/1',plan_id=report['plan_id'],files={'implementation-difficulties.md':'实现难点、受影响对象与建议','implementation-difficulties.json':'机器可读的分类问题清单','report.html':'可阅读的完整评估报告','resource-report.json':'资源指标、假设、违例与布局数据','layout-plan.yml':'可再次输入的partition/floorplan方案'},units={'geometry':'um','die_area':'mm2','power':'W','current':'A','logical_width':'bit'},scope=assessment['scope'])
    if not compact:(output/'output-manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf-8')
    esc = lambda v: html.escape(str(v))
    limits = ''.join(f'<li>{esc(s)}</li>' for s in report['assumptions'])
    link_rows = ''.join('<tr>'+''.join(f'<td>{esc(value)}</td>' for value in [
        f"{l['source']}.{l.get('source_port','out')} → {l['target']}.{l.get('target_port','in')}",
        l.get('bus_width_bits') if l.get('bus_width_bits') is not None else '未提供',l.get('data_wires','未知'),
        l.get('control_wires','未知'),l.get('spare_wires','未知'),l['wires'],l['bandwidth_GBps'],l['planar_length_um'],l['tier_hops']])+'</tr>' for l in report['links'])
    metal_rows = ''.join('<tr>'+''.join(f'<td>{esc(m[k])}</td>' for k in ['name','direction','width_um','pitch_um'])+'</tr>' for m in report['project']['resources']['metals'])
    connection_section = '<h2>模块互联位宽与线数</h2><p>逻辑位宽与并行数据线数分开记录；合计包含控制与冗余。未提供的位宽不从模块位宽或串行通道数猜测。</p><table><tr><th>连接</th><th>位宽 bit</th><th>数据线</th><th>控制线</th><th>冗余线</th><th>合计</th><th>GB/s</th><th>线长 µm</th><th>跨层数</th></tr>'+link_rows+'</table><h3>金属线宽和间距（工艺参考）</h3><p>逐段金属层预算分配见下表，尚未进行详细布线。</p><table><tr><th>金属层</th><th>方向</th><th>单线宽 µm</th><th>中心间距 µm</th></tr>'+metal_rows+'</table>'
    def number(value):
        if value is None:
            return '未知'
        return format(value,'.7g') if isinstance(value,float) else str(value)
    def table(headers, rows):
        return '<div class="table"><table><tr>'+''.join(f'<th>{esc(h)}</th>' for h in headers)+'</tr>'+''.join('<tr>'+''.join(f'<td>{esc(number(v))}</td>' for v in row)+'</tr>' for row in rows)+'</table></div>'
    wiring=report.get('wiring')
    wire_section=''
    if wiring:
        wire_section='<h2>互联面积预算（分配层逐段求和）</h2>'+table(['连接','Die','方向','分配金属层','线数','L µm','w µm','pitch µm','线束宽 µm','金属面积 µm²','轨道面积 µm²'],[
            [r['link'],r['die'],r['direction'],r['reference_metal'],r['wires'],r['length_um'],r['width_um'],r['pitch_um'],r['bundle_width_um'],r['metal_area_um2'],r['track_area_um2']] for r in wiring['segments']])
        wire_section+='<p>合计金属面积需求 '+esc(number(wiring['metal_area_um2']))+' µm²；轨道面积预算 '+esc(number(wiring['track_area_um2']))+' µm²。</p><ul>'+''.join('<li>'+esc(n)+'</li>' for n in wiring['notes'])+'</ul>'
    calculation_section='<h2>指标公式与数值代入</h2>'
    for die in report.get('calculations',{}).get('dies',[]):
        calculation_section+='<h3>'+esc(die['die'])+'</h3>'
        for metric in die['metrics']:
            calculation_section+='<details><summary>'+esc(metric['title'])+'</summary><p>'+esc(metric['formula'])+'</p><p>'+esc(metric['substitution'])+'</p><p class="note">'+esc(metric['note'])+'</p></details>'
    method_section=''
    methods=report.get('methodology')
    if methods:
        tech,util,signals,routing,search=(methods[k] for k in ['technology','utilization','signals','routing','optimization'])
        method_section='<h2>工艺与规划参数依据</h2><h3>'+esc(tech['name'])+'</h3><p>'+esc(tech['source'])+'</p><p>'+esc(tech['scope'])+'</p><p>'+esc(tech.get('builtin_reference',''))+'</p><p>TSV 来源：'+esc(tech['tsv_source'])+'</p><p>'+esc(util['ownership'])+'</p><p>'+esc(util['definition'])+'</p>'
        definitions={m['id']:m for m in report['project']['architecture']['modules']}
        method_section+=table(['模块','目标标准单元利用率','实际标准单元利用率','目标设定依据'],[
            [m['id'],number(definitions[m['id']]['target_cell_utilization']*100)+'%',None if m['cell_utilization'] is None else number(m['cell_utilization']*100)+'%',definitions[m['id']].get('utilization_basis') or '未提供；规划输入，需架构/后端确认'] for m in report['modules']])
        method_section+='<h3>'+esc(signals['name'])+'</h3><p>'+esc(signals['formula'])+'</p><p>'+esc(signals['example'])+'</p><p>'+esc(signals['exclusions'])+'</p><h3>'+esc(routing['name'])+'</h3><p>'+esc(routing['description'])+'</p>'
        method_section+='<h2>自动布局算法与最优性范围</h2><p>'+esc(search['algorithm'])+f" · 网格 {search['grid_um']} µm · 时间上限 {search['time_limit_s']} s</p><p>"+esc(search['objective'])+'</p><p>'+esc(search['constraints'])+'</p><p>'+esc(search['limitations'])+'</p><p>'+esc(search['ranking'])+'</p><p>'+esc(search['optimality'])+'</p>'
        candidate=report.get('candidate')
        if candidate:
            method_section+=table(['求解状态','代理目标值','目标下界','相对差距','已排除先前解数'],[[candidate['solver_status'],candidate['surrogate_objective'],candidate['objective_bound'],None if candidate.get('relative_gap') is None else number(candidate['relative_gap']*100)+'%',candidate.get('previous_candidates_excluded')]])
            method_section+='<p>下界仅适用于该次搜索的解空间。后续候选已排除先前找到的解。</p>'
        endpoint_rows=[]
        for link in report['links']:
            for role,e in link.get('endpoints',{}).items():
                endpoint_rows.append([link['id'],'源' if role=='source' else '目标',e['die'],e['side'],e['point'][0],e['point'][1],'输入指定' if e['source']=='specified_port' else '自动边中点'])
        method_section+='<h3>模块边缘端点</h3>'+table(['连接','端点','Die','边','X µm','Y µm','位置来源'],endpoint_rows)
    physical_section=''
    routing=report.get('metal_routing')
    if routing:
        physical_section='<h2>逐金属层容量检查</h2>'+table(['Die','金属层','方向','可用比例','容量 / 格','峰值需求','峰值比','超限格','热点格','热点连接'],[[r['die'],r['metal'],r['direction'],r['availability'],r['capacity_tracks'],r['peak_demand_tracks'],'零容量有需求' if r['zero_capacity_demand'] else r['peak_ratio'],r['overflow_cells'],str(r['peak_cell']['x'])+','+str(r['peak_cell']['y']),', '.join(r['peak_cell']['links'])] for r in routing['layers']])
        physical_section+='<h2>模块间距与通道约束</h2><p>边到边间距要求 = max(全局间距, 两个模块 halo 之和)。通道单独预留，不允许模块或 halo 侵占。</p>'+table(['Die','模块对','要求 µm','实际 µm','余量 µm','通过'],[[r['die'],' / '.join(r['modules']),r['required_um'],r['actual_um'],r['margin_um'],r['passed']] for r in report.get('spacing',[])])
        physical_section+=table(['通道','Die','金属层','净宽 µm','最小宽 µm','需求','容量','余量','通过'],[[r['channel'],r['die'],r['metal'],r['width_um'],r['min_width_um'],r['demand_tracks'],r['capacity_tracks'],r['margin_tracks'],r['passed']] for r in routing['channels']])
        physical_section+='<p>通道按完整线束的同时截面需求检查；网格按逐层长度加权需求检查。分配为架构级预算，未详细分轨或完成转层过孔校验。</p>'
    statuses = {'violations':'发现实现性违例','incomplete':'数据不足，尚不能确认可行','within_model_constraints':'通过当前模型检查'}
    s = report['summary']
    summary_names = [('errors','实现性违例','项'),('unknowns','缺失数据','项'),('die_count','堆叠层数','层'),('module_count','模块数','个'),('total_die_area_mm2','各层 die 面积之和','mm²'),('total_module_footprint_mm2','模块矩形面积之和','mm²'),('power_W','总功耗','W'),('weighted_wirelength_um','加权平面线长','wire·µm'),('peak_congestion','峰值拥塞需求 / 容量',''),('signal_via_segments','信号 TSV 需求（逐接口累加）','个接口位置'),('signal_hb_sites','信号 HB 接口预算','bit'),('total_via_segments','全部跨层站点（含电源、地）','个')]
    overview=table(['指标','值','单位'],[(title,s.get(key),unit) for key,title,unit in summary_names])
    dies=table(['Die','宽 × 高 µm','面积 mm²','有效区域占用率','模块占地 mm²','预留区 mm²','剩余可用 mm²','功耗 W','功耗余量 W','拥塞比'],[
        [d['id'],f"{number(d['width_um'])} × {number(d['height_um'])}",d['area_mm2'],None if d['footprint_utilization'] is None else number(d['footprint_utilization']*100)+'%',d['module_area_mm2'],d['reserved_area_mm2'],d['free_area_mm2'],d['power_W'],d['power_margin_W'],d['peak_congestion']] for d in report['dies']])
    supply=table(['Die / 电压域','本层电流 A','入口需求 A','端口能力 A','余量 A'],[
        [f"{r['die']} / {r['domain']}",r['local_current_A'],r['injection_current_A'],r['capacity_A'],r['margin_A']] for r in report['supply']])
    supply+=table(['Die / 核 / 电压域','接入方式','需求 A','能力 A','余量 A'],[
        [f"{r['die']} / {r['core']} / {r['domain']}",r['feed'],r['demand_A'],r['capacity_A'],r['margin_A']] for r in report.get('supply_groups',[])])
    timing=report.get('timing',{})
    if timing.get('model'):
        supply+='<h3>数据通路延迟估算</h3><p>'+esc(timing['model']['provenance'])+'</p>'+table(['加权总延迟 ps（不是执行时间）','最长单连接 ps','参数已校准'],[[timing['weighted_delay_ps'],timing['max_link_delay_ps'],timing['model']['calibrated']]])+'<p>'+esc(timing['scope'])+'</p>'
    vias=table(['层间接口','信号','电源','地','总需求','可用容量','余量'],[
        [f"{r['lower_die']} ↔ {r['upper_die']} ({r.get('interconnect','TSV')} / {r.get('orientation','unspecified')})",r['signal_vias'],r['power_vias'],r['ground_vias'],r['total_vias'],r['capacity'],r['margin']] for r in report['interfaces']]) if report['interfaces'] else '<p>单层工程，无跨层接口。</p>'
    severity={'error':'违例','unknown':'数据缺失','warning':'提示'}
    issues=''.join(f'<li class="{esc(i["severity"])}"><b>{severity.get(i["severity"],esc(i["severity"]))} · {esc(i["subject"])}</b><p>{esc(i["reason"])}</p><p>建议：{esc(i["suggestion"])}</p></li>' for i in sorted(report['issues'],key=lambda i:{'error':0,'unknown':1,'warning':2}.get(i['severity'],3))) or '<li>在当前输入和模型范围内未发现违例。</li>'
    title=report.get('storage',{}).get('run_name') or report['name']
    page=f'''<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>{esc(title)} · Resim 报告</title>
<style>body{{font:15px/1.65 system-ui,"Microsoft YaHei",sans-serif;margin:30px auto;padding:0 24px;max-width:1250px;background:#f5f7fb;color:#18273c}}h1{{font-size:25px}}h2{{font-size:20px;margin-top:30px}}.table{{overflow:auto}}table{{border-collapse:collapse;width:100%;background:white;font-variant-numeric:tabular-nums}}th,td{{text-align:left;padding:9px 12px;border:1px solid #d8e1ed}}th{{background:#eaf0f5;white-space:nowrap}}li{{margin:12px 0}}li p{{margin:3px 0}}.status{{padding:14px 18px;background:#e8f1ee;border:1px solid #8daea1;border-radius:6px}}.incomplete{{background:#fff5db;border-color:#c7a355}}.violations{{background:#ffebe6;border-color:#cb8370}}.error b{{color:#a33120}}.unknown b{{color:#806111}}.note{{color:#596d80}}nav a{{margin-right:20px;color:#286b76}}@media print{{body{{margin:0;background:white;font-size:11px}}table{{font-size:10px}}h2{{break-after:avoid}}tr{{break-inside:avoid}}}}</style></head><body>
<h1>{esc(title)}</h1><p class="note">工程：{esc(report['name'])} · Resim {esc(report.get('simulator_version','历史版本'))} · 方案 {esc(report['plan_id'])}</p>
<div class="status {esc(report['status'])}"><b>{statuses.get(report['status'],esc(report['status']))}</b><br>{s['errors']} 项违例 · {s['unknowns']} 项缺失数据。数据缺失时，零违例不代表已经可行。</div>
<nav><a href="#resources">资源</a><a href="#links">互联</a><a href="#supply">供电 / TSV</a><a href="#issues">实现性问题</a></nav>
<h2>资源概况</h2>{overview}{method_section}<h2 id="resources">逐层资源用量</h2>{dies}{physical_section}<p class="note">有效区域占用率 = 禁布区以外的模块占地并集 / 可布局面积。重叠与越界单独报错；各层面积之和不等于封装占地。</p>
<div id="links">{connection_section}{wire_section}</div><h2 id="supply">供电资源</h2><p>底层入口需求包含向上供电的负载，本层电流只统计本层。</p>{supply}<h3>TSV 接口预算</h3>{vias}{calculation_section}
<h2 id="issues">实现性问题与建议</h2><ul>{issues}</ul><h2>模型边界与来源</h2><ul>{limits}</ul><p>工艺：{esc(report['provenance']['technology'])}<br>来源：{esc(report['provenance']['source'])}</p></body></html>'''
    (output/'report.html').write_text(page,encoding='utf-8')
