export const SEVERITIES={error:'实现性违例',warning:'风险与提示',unknown:'待补数据'};
export function difficultyPage(issues,severity,page=0,size=30){
  const filtered=issues.map((issue,index)=>({...issue,index})).filter(i=>i.severity===severity);
  const pages=Math.max(1,Math.ceil(filtered.length/size)),current=Math.max(0,Math.min(page,pages-1));
  return {items:filtered.slice(current*size,(current+1)*size),total:filtered.length,pages,page:current};
}
