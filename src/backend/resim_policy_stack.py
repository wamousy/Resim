"""Stack geometry rules shared by all engine entry points (no solver changes)."""
import copy
import json
import re

RULE_VERSION = 'resim-stack/2'
MARKER = re.compile(r'\n?\[resim-stack/1\]\n([\s\S]*?)\n\[/resim-stack\]')


def migrate_stack(value):
    value = copy.deepcopy(value)
    if not isinstance(value, dict):
        return value
    architecture = value.get('architecture', {})
    if not isinstance(architecture, dict):
        return value  # Let the formal schema return a field error, not an exception.
    description = architecture.get('description', '')
    if not isinstance(description, str):
        return value
    match = MARKER.search(description)
    if match:
        old = json.loads(match.group(1))
        if value.get('stack') is not None and value['stack'] != old:
            raise ValueError('stack conflicts with legacy description metadata')
        value['stack'] = old
        architecture['description'] = MARKER.sub('', description).strip()
    return value


def stack_issues(project):
    p = migrate_stack(project)
    explicit = (p.get('stack') or {}).get('die_faces', {})
    dies = sorted(p['architecture']['dies'], key=lambda d: d['order'])
    regions = p['floorplan'].get('tsv_regions', [])
    issues, faces, paired = [], {}, set()

    def issue(severity, subject, reason, suggestion):
        issues.append(dict(severity=severity, subject=subject, reason=reason, suggestion=suggestion, code='STACK_GEOMETRY'))

    for d in dies:
        claims = set()
        for r in regions:
            if r.get('orientation') == 'F2F':
                if r['lower_die'] == d['id']: claims.add('up')
                if r['upper_die'] == d['id']: claims.add('down')
            if r.get('orientation') == 'B2B':
                if r['lower_die'] == d['id']: claims.add('down')
                if r['upper_die'] == d['id']: claims.add('up')
        face = explicit.get(d['id'], next(iter(claims)) if len(claims) == 1 else 'conflict' if claims else 'unknown')
        faces[d['id']] = face
        if face == 'conflict':
            issue('error', d['id'], '相邻接口对同一 Die 的朝向要求冲突', '在架构输入中统一 Die 朝向及接口方式')
        if face == 'unknown' and not d.get('display_platform'):
            issue('unknown', d['id'], '尚未指定正面朝向', '在架构输入中选择正面朝上或朝下')
    for lower, upper in zip(dies, dies[1:]):
        group = [r for r in regions if r['lower_die'] == lower['id'] and r['upper_die'] == upper['id']]
        paired.update(r['id'] for r in group)
        lf, uf = faces[lower['id']], faces[upper['id']]
        orientation = ('F' if lf == 'up' else 'B') + '2' + ('F' if uf == 'down' else 'B') if lf in ('up', 'down') and uf in ('up', 'down') else 'unspecified'
        subject = lower['id'] + ' ↔ ' + upper['id']
        if not group:
            issue('unknown', subject, '层间接口未定义', '导入含该相邻层接口区域及资源预算的芯片架构 YAML')
        if any(r.get('interconnect') == 'HB' for r in group) and orientation != 'F2F':
            issue('unknown' if orientation == 'unspecified' else 'error', subject,
                  '当前直接 HB 模型需要两个正面相对；此配置为 ' + orientation,
                  '使用 F2F 朝向，或补充背面金属与穿硅路径模型后再评估其他 HB 结构')
        if orientation != 'unspecified' and any(r.get('orientation') in ('F2F', 'B2B') and r['orientation'] != orientation for r in group):
            issue('error', subject, '接口的朝向标记与 Die 朝向不一致', '应用结构时重新按 Die 朝向生成接口关系')
    for r in regions:
        if r['id'] not in paired:
            issue('error', r['id'], '接口端点不是按堆叠顺序排列的相邻层', '检查 lower_die / upper_die 和 Die 顺序；跨多层连接须逐接口定义')
    return issues


def assess(report):
    known = {(i['severity'], i['code'], i['subject'], i['reason']) for i in report['issues']}
    for issue in stack_issues(report['project']):
        key = tuple(issue[k] for k in ('severity', 'code', 'subject', 'reason'))
        if key not in known:
            report['issues'].append(issue)
            known.add(key)
    for severity, key in [('error', 'errors'), ('unknown', 'unknowns'), ('warning', 'warnings')]:
        report['summary'][key] = sum(i['severity'] == severity for i in report['issues'])
    report['assessment_scope'] = 'engine + ' + RULE_VERSION
    return report
