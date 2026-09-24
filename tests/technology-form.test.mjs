import test from 'node:test';
import assert from 'node:assert/strict';
import {updateTechnology} from '../_internal/resim/static/technology-form.js';
const values=()=>({technology:'sample',provenance:'user',availability:'0.15',metals:[{name:'M2',direction:'HORIZONTAL',width_um:'0.1',pitch_um:'0.2',availability:''},{name:'M3',direction:'VERTICAL',width_um:'0.2',pitch_um:'0.4',availability:'0'}],tsv:{diameter_um:'5',pitch_um:'10',keepout_um:'0',bond_pitch_um:'2',max_current_mA:'5',provenance:'sample'}});
test('technology form preserves unedited calibration and notes; distinguishes inheritance, zero capacity and disabled TSV',()=>{
 const base={notes:['source'],delay_model:{planar_ps_per_um:0.1}},v=values(),r=updateTechnology(base,v);
 assert.deepEqual(r.notes,base.notes);assert.deepEqual(r.delay_model,base.delay_model);assert.equal(r.metals[0].availability,null);assert.equal(r.metals[1].availability,0);assert.equal(r.tsv.keepout_um,0);assert.equal(base.metals,undefined);
 assert.equal(updateTechnology(r,{...v,tsv:null}).tsv,null);
});
test('reject ambiguous metal IDs, invalid capacities and impossible wire/TSV pitch',()=>{
 for(const change of [v=>v.metals[1].name='M2',v=>v.metals[0].width_um='0.3',v=>v.metals[0].availability='1.1',v=>v.metals[0].availability='-0.1',v=>v.availability='',v=>v.tsv.pitch_um='4']){const v=values();change(v);assert.throws(()=>updateTechnology({},v));}
});
