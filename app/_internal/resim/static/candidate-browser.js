export function candidateCount(value){
  const text=String(value).trim(),count=Number(text);
  if(!/^\d+$/.test(text)||!Number.isSafeInteger(count)||count<1)throw new Error('候选数量须为正整数。');
  return count;
}
export function searchCompletion(result,count,requested){
  const statuses=result?.solver_statuses||[];
  if(statuses.at(-1)==='INFEASIBLE')return `当前离散约束下的布局已穷尽，共 ${count} 个不同候选。`;
  if(count<requested)return `本次找到 ${count} 个不同候选；时间预算内未达到请求数量，尚未确定最多可生成多少个。`;
  return '已达到请求数量；未穷尽全部布局。';
}

// One scrolling row, with a keyboard-accessible slider for the entire list.
export class CandidateBrowser{
  constructor(host){this.host=host;this.run=null;this.left=0;}
  bind(run){
    this.observer?.disconnect();
    const list=this.host.querySelector('.candidate-list'),controls=this.host.querySelector('.candidate-scroll'),slider=this.host.querySelector('[data-candidate-slider]');
    if(!list)return;
    if(this.run!==run)this.left=0;this.run=run;
    const max=()=>Math.max(0,list.scrollWidth-list.clientWidth);
    const update=()=>{
      const end=max();controls.hidden=end<2;
      slider.value=end?Math.round(list.scrollLeft/end*1000):0;
      this.left=list.scrollLeft;
      controls.querySelector('[data-candidate-prev]').disabled=list.scrollLeft<=1;
      controls.querySelector('[data-candidate-next]').disabled=list.scrollLeft>=end-1;
      const rect=list.getBoundingClientRect(),cards=[...list.children],visible=cards.map((c,i)=>({i,r:c.getBoundingClientRect()})).filter(c=>c.r.right>rect.left+2&&c.r.left<rect.right-2);
      const text=visible.length?`${visible[0].i+1}–${visible.at(-1).i+1} / ${cards.length}`:'';
      controls.querySelector('output').textContent=text;slider.setAttribute('aria-valuetext',text);
    };
    slider.oninput=()=>{list.scrollLeft=Number(slider.value)/1000*max();update();};
    controls.querySelector('[data-candidate-prev]').onclick=()=>list.scrollBy({left:-list.clientWidth*.85,behavior:'smooth'});
    controls.querySelector('[data-candidate-next]').onclick=()=>list.scrollBy({left:list.clientWidth*.85,behavior:'smooth'});
    list.onscroll=update;
    list.onkeydown=event=>{
      if(event.target!==list)return;
      if(event.key==='ArrowRight'||event.key==='ArrowLeft'){event.preventDefault();list.scrollBy({left:(event.key==='ArrowRight'?1:-1)*270,behavior:'smooth'});}
    };
    list.scrollLeft=this.left;
    this.observer=new ResizeObserver(update);this.observer.observe(list);
    const active=list.querySelector('[aria-pressed="true"]');
    if(active&&list.clientWidth){const a=active.getBoundingClientRect(),r=list.getBoundingClientRect();if(a.left<r.left)list.scrollLeft+=a.left-r.left;else if(a.right>r.right)list.scrollLeft+=a.right-r.right;}
    update();
  }
  clear(){this.observer?.disconnect();this.run=null;this.left=0;}
}
