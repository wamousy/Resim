"""Architecture decision summary; unknown data never becomes a feasibility pass."""
def summarize(report):
    groups={}
    for issue in report['issues']:
        key=(issue['severity'],issue['code'])
        row=groups.setdefault(key,dict(severity=key[0],code=key[1],count=0,subjects=[],reasons=[],suggestions=[]))
        row['count']+=1
        for field,source in [('subjects','subject'),('reasons','reason'),('suggestions','suggestion')]:
            if issue[source] not in row[field]:row[field].append(issue[source])
    ordered=sorted(groups.values(),key=lambda r:({'error':0,'warning':1,'unknown':2}.get(r['severity'],3),-r['count'],r['code']))
    return dict(schema_version='resim-feasibility/1',plan_id=report['plan_id'],status=report['status'],groups=ordered,scope='架构级资源估算，不能替代后端签核；缺失数据不表示资源为零。',planning_outputs=['layout-plan.yml','resource-report.json','report.html'])
