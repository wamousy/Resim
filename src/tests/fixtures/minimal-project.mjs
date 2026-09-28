// Synthetic regression input; deliberately independent of user projects and PDKs.
export function minimalProject(){
  return {
    schema_version:'resim/0.1',name:'Synthetic resource regression',
    architecture:{chip:'test_chip',description:'Synthetic test data, not a calibrated technology.',
      dies:[{id:'die0',kind:'logic',order:0,width_um:100,height_um:100,thickness_um:50,voltage_V:1,power_budget_W:10,max_utilization:.8}],
      cores:[{id:'core0',keep_on_same_die:true}],
      modules:['producer','consumer'].map(id=>({id,core:'core0',kind:'logic',allowed_dies:['die0'],width_um:10,height_um:10,stdcell_area_um2:20,macro_area_um2:0,area_known:true,power_W:1,target_cell_utilization:.5,ports:['in','out'],provenance:'Synthetic test input'})),
      links:[{id:'data',source:'producer',target:'consumer',source_port:'out',target_port:'in',bandwidth_GBps:1,lane_rate_Gbps:1,bus_width_bits:8,data_wires:8,control_wires:0,spare_fraction:0}]},
    resources:{technology:'Synthetic test technology',technology_provenance:'Test fixture only',routing_availability:.5,metals:[{name:'M1',direction:'HORIZONTAL',width_um:.1,pitch_um:.2},{name:'M2',direction:'VERTICAL',width_um:.1,pitch_um:.2}],tsv:null},
    constraints:{die_area_limit_mm2:.01,max_congestion_ratio:1,min_module_spacing_um:2},
    floorplan:{placements:[{module:'producer',die:'die0',x_um:10,y_um:10,width_um:10,height_um:10},{module:'consumer',die:'die0',x_um:40,y_um:40,width_um:10,height_um:10}],tsv_regions:[],supply_ports:[{id:'supply',die:'die0',domain:'VDD',x_um:0,y_um:50,voltage_V:1,max_current_A:5,feed:'external'}]},
    search:{objective:'wirelength',time_limit_s:10,candidates:3,grid_um:1,seed:7,wirelength_weight:1,tier_crossing_weight:0,congestion_grid:8}
  };
}
