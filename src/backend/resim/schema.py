from __future__ import annotations

import io
import math
from typing import Literal
from pydantic import BaseModel, ConfigDict, Field, model_validator
from ruamel.yaml import YAML


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)


class Metrics(Strict):
    compute_TOPS: float | None = Field(default=None, ge=0)
    bandwidth_GBps: float | None = Field(default=None, ge=0)
    capacity_KiB: float | None = Field(default=None, ge=0)
    precision: str = "unspecified"
    frequency_MHz: float | None = Field(default=None, gt=0)
    bit_width: int | None = Field(default=None, gt=0)


class Die(Strict):
    id: str
    display_platform: bool = False
    package_layers: int = Field(default=1, ge=1)
    kind: Literal["logic", "dram", "other"]
    order: int = Field(ge=0)
    width_um: float = Field(gt=0)
    height_um: float = Field(gt=0)
    thickness_um: float = Field(gt=0)
    voltage_V: float = Field(gt=0)
    power_budget_W: float | None = Field(default=None, gt=0)
    max_utilization: float = Field(default=0.85, gt=0, le=1)
    metrics: Metrics = Field(default_factory=Metrics)


class Core(Strict):
    id: str
    keep_on_same_die: bool = False
    metrics: Metrics = Field(default_factory=Metrics)


class PortLocation(Strict):
    side: Literal['east','west','north','south']
    offset: float = Field(default=.5,ge=0,le=1,description='Fraction along edge; west/east from bottom, north/south from left')


class PlacementWindow(Strict):
    x_um: float = Field(ge=0)
    y_um: float = Field(ge=0)
    width_um: float = Field(gt=0)
    height_um: float = Field(gt=0)


class Module(Strict):
    shared_cores: list[str] = Field(default_factory=list, description="Cores served by one shared physical instance; core is its placement anchor, not a duplicate instance")
    id: str
    area_known: bool = True
    core: str
    kind: str
    allowed_dies: list[str] = Field(min_length=1)
    stdcell_area_um2: float = Field(ge=0)
    macro_area_um2: float = Field(ge=0)
    power_W: float | None = Field(default=None, ge=0)
    width_um: float = Field(gt=0)
    height_um: float = Field(gt=0)
    target_cell_utilization: float = Field(default=0.65, gt=0, le=1)
    utilization_basis: str | None = Field(default=None,description='Owner or evidence for target utilization; not a PDK rule')
    halo_um: float = Field(default=0, ge=0, description='External placement clearance on every side, not internal whitespace')
    voltage_domain: str = "VDD"
    fixed: bool = False
    placement_window: PlacementWindow | None = None
    ports: list[str] = Field(default_factory=lambda: ["in", "out"])
    port_locations: dict[str,PortLocation] = Field(default_factory=dict)
    metrics: Metrics = Field(default_factory=Metrics)
    provenance: str


class WireAreaReference(Strict):
    horizontal: str | None = None
    vertical: str | None = None


class Link(Strict):
    id: str
    source: str
    target: str
    source_port: str = "out"
    target_port: str = "in"
    bus_width_bits: int | None = Field(default=None, ge=1, description="Logical payload width; independent of serialized physical data lanes")
    bandwidth_GBps: float | None = Field(default=None, ge=0)
    lane_rate_Gbps: float | None = Field(default=None, gt=0)
    provenance: str | None = None
    data_wires: int | None = Field(default=None, ge=1)
    control_wires: int = Field(default=8, ge=0)
    spare_fraction: float = Field(default=0.1, ge=0, le=1)
    max_planar_length_um: float | None = Field(default=None, gt=0)
    max_tier_hops: int | None = Field(default=None, ge=0)
    latency_weight: int = Field(default=1, ge=1, le=1000)
    area_reference: WireAreaReference = Field(default_factory=WireAreaReference, description="Reference metals for area budgeting only; not a routed layer assignment")
    routing_layers: dict[Literal['horizontal','vertical'], list[str]] = Field(default_factory=dict, description='Allowed metals by direction. Wires may be split across these layers. Omitted direction uses all matching enabled layers.')

    @property
    def required_lanes(self):
        if self.bandwidth_GBps is None or self.lane_rate_Gbps is None:
            return None
        return math.ceil(self.bandwidth_GBps * 8 / self.lane_rate_Gbps)

    @model_validator(mode="after")
    def lane_budget(self):
        if self.data_wires is None and self.required_lanes is None:
            raise ValueError('provide data_wires, or both bandwidth_GBps and lane_rate_Gbps')
        return self

    @property
    def wires(self):
        return math.ceil(((self.data_wires if self.data_wires is not None else self.required_lanes) + self.control_wires) * (1 + self.spare_fraction))

    @property
    def allocated_data_wires(self):
        return self.data_wires if self.data_wires is not None else self.required_lanes

    @property
    def spare_wires(self):
        return self.wires - self.allocated_data_wires - self.control_wires


class ReferenceGroup(Strict):
    """Source estimates for a component or subsystem, never additive child costs."""
    id: str
    modules: list[str] = Field(min_length=1)
    source: str
    label: str
    width_um: float | None = Field(default=None, gt=0)
    height_um: float | None = Field(default=None, gt=0)
    area_estimate_um2: float | None = Field(default=None, ge=0)
    area_basis: str = ''
    cell_count: int | None = Field(default=None, ge=0)
    pin_counts: dict[str, int] = Field(default_factory=dict)
    notes: list[str] = Field(default_factory=list)


class Architecture(Strict):
    chip: str
    description: str
    metrics: Metrics = Field(default_factory=Metrics)
    dies: list[Die] = Field(min_length=1)
    cores: list[Core] = Field(min_length=1)
    modules: list[Module] = Field(min_length=1)
    links: list[Link] = Field(default_factory=list)
    reference_groups: list[ReferenceGroup] = Field(default_factory=list)


class Metal(Strict):
    name: str
    direction: Literal["HORIZONTAL", "VERTICAL"]
    pitch_um: float = Field(gt=0)
    width_um: float = Field(gt=0)
    availability: float | None = Field(default=None, ge=0, le=1, description='Per-layer usable fraction; overrides routing_availability. Zero disables automatic allocation.')

    @model_validator(mode="after")
    def geometry(self):
        if self.width_um > self.pitch_um:
            raise ValueError("metal width must not exceed center-to-center pitch")
        return self


class TSV(Strict):
    diameter_um: float = Field(gt=0)
    pitch_um: float = Field(gt=0)
    keepout_um: float = Field(ge=0)
    bond_pitch_um: float = Field(gt=0)
    max_current_mA: float = Field(gt=0)
    provenance: str

    @model_validator(mode="after")
    def pitch_check(self):
        if self.pitch_um < self.diameter_um + 2 * self.keepout_um:
            raise ValueError("TSV pitch must cover diameter + 2 * keepout")
        return self


class DelayModel(Strict):
    planar_ps_per_um: float = Field(gt=0)
    tier_ps: float = Field(ge=0)
    provenance: str = Field(min_length=1)
    calibrated: bool = False


class Resources(Strict):
    technology: str
    technology_provenance: str
    metals: list[Metal] = Field(default_factory=list)
    routing_availability: float = Field(default=0.15, gt=0, le=1)
    tsv: TSV | None = None
    delay_model: DelayModel | None = None
    notes: list[str] = Field(default_factory=list)


class Rect(Strict):
    x_um: float = Field(ge=0)
    y_um: float = Field(ge=0)
    width_um: float = Field(gt=0)
    height_um: float = Field(gt=0)


class Placement(Rect):
    module: str
    die: str


class Region(Rect):
    id: str
    interconnect: Literal['TSV','HB'] = 'TSV'
    orientation: Literal['F2F','B2B','unspecified'] = 'unspecified'
    signal_budget_bits: int | None = Field(default=None, ge=0)
    budget_paths: list[str] = Field(default_factory=list)
    interface_pitch_um: float | None = Field(default=None, gt=0)
    lower_die: str
    upper_die: str
    core: str | None = Field(default=None, description="Optional owner core/tile used to select one of several TSV regions on the same interface")


class Blockage(Rect):
    id: str
    die: str


class RoutingChannel(Rect):
    id: str
    die: str
    direction: Literal['HORIZONTAL','VERTICAL']
    min_width_um: float = Field(default=0, ge=0)
    metals: list[str] = Field(min_length=1)
    links: list[str] = Field(default_factory=list, description='Bound connections must remain on this die and traverse the corridor centerline')


class SupplyPort(Strict):
    id: str
    die: str
    x_um: float = Field(ge=0)
    y_um: float = Field(ge=0)
    domain: str = "VDD"
    voltage_V: float = Field(gt=0)
    max_current_A: float | None = Field(default=None, gt=0)
    core: str | None = None
    provenance: str | None = None
    feed: Literal["external", "stack_base"] = "external"


class Constraints(Strict):
    die_area_limit_mm2: float = Field(default=800, gt=0)
    max_congestion_ratio: float = Field(default=1, gt=0)
    max_power_density_W_mm2: float | None = Field(default=None, gt=0)
    same_die_groups: list[list[str]] = Field(default_factory=list)
    blockages: list[Blockage] = Field(default_factory=list)
    min_module_spacing_um: float = Field(default=0, ge=0)
    routing_channels: list[RoutingChannel] = Field(default_factory=list)


class Floorplan(Strict):
    placements: list[Placement] = Field(default_factory=list)
    tsv_regions: list[Region] = Field(default_factory=list)
    supply_ports: list[SupplyPort] = Field(default_factory=list)


class Search(Strict):
    objective: Literal['wirelength', 'latency'] = 'wirelength'
    time_limit_s: float = Field(default=12, gt=0, le=300)
    candidates: int = Field(default=3, ge=1, le=10)
    grid_um: float = Field(default=10, gt=0)
    seed: int = Field(default=7, ge=0)
    wirelength_weight: int = Field(default=1, ge=0)
    tier_crossing_weight: int = Field(default=500, ge=0)
    congestion_grid: int = Field(default=16, ge=4, le=64)


class Project(Strict):
    schema_version: Literal["resim/0.1"] = "resim/0.1"
    name: str
    architecture: Architecture
    resources: Resources
    constraints: Constraints = Field(default_factory=Constraints)
    floorplan: Floorplan = Field(default_factory=Floorplan)
    search: Search = Field(default_factory=Search)

    @model_validator(mode="after")
    def references(self):
        a = self.architecture
        def unique(values, label):
            if len(set(values)) != len(values):
                raise ValueError(f"duplicate {label}")
        for items, label in [(a.dies, "die"), (a.cores, "core"), (a.modules, "module"), (a.links, "link"), (self.floorplan.tsv_regions, "TSV region"), (self.floorplan.supply_ports, "supply port")]:
            unique([x.id for x in items], label)
        unique([m.name for m in self.resources.metals], "metal layer")
        unique([c.id for c in self.constraints.routing_channels], 'routing channel')
        ds, cs, ms = {d.id: d for d in a.dies}, {c.id for c in a.cores}, {m.id: m for m in a.modules}
        unique([g.id for g in a.reference_groups], 'reference group')
        for g in a.reference_groups:
            unique(g.modules, 'reference group member')
            if not set(g.modules) <= ms.keys():
                raise ValueError(f'unknown reference group module: {g.id}')
            if any(v < 0 for v in g.pin_counts.values()):
                raise ValueError(f'negative reference pin count: {g.id}')
        if sorted(d.order for d in a.dies) != list(range(len(a.dies))):
            raise ValueError("die order must be consecutive from zero")
        for m in a.modules:
            if m.core not in cs or not set(m.allowed_dies) <= ds.keys():
                raise ValueError(f"unknown core/die for {m.id}")
            unique(m.ports, f"ports of {m.id}")
            if not set(m.port_locations)<=set(m.ports):
                raise ValueError(f"port location refers to unknown port: {m.id}")
        for l in a.links:
            if l.source not in ms or l.target not in ms or l.source == l.target:
                raise ValueError(f"invalid endpoints: {l.id}")
            if l.source_port not in ms[l.source].ports or l.target_port not in ms[l.target].ports:
                raise ValueError(f"unknown port: {l.id}")
            for direction, name in [('HORIZONTAL',l.area_reference.horizontal),('VERTICAL',l.area_reference.vertical)]:
                if name is not None and not any(m.name == name and m.direction == direction for m in self.resources.metals):
                    raise ValueError(f"invalid {direction} area reference metal for {l.id}: {name}")
            for direction, names in l.routing_layers.items():
                if not names or len(names)!=len(set(names)):
                    raise ValueError(f'empty or duplicate routing layers: {l.id}')
                if any(not any(m.name==name and m.direction==direction.upper() for m in self.resources.metals) for name in names):
                    raise ValueError(f'invalid routing layer direction/name: {l.id}')
        known_cores={c.id for c in self.architecture.cores}
        for module in self.architecture.modules:
            if len(set(module.shared_cores))!=len(module.shared_cores) or not set(module.shared_cores)<=known_cores:
                raise ValueError(f'invalid shared core membership: {module.id}')
        bound_links=set()
        for channel in self.constraints.routing_channels:
            if channel.die not in ds or len(set(channel.metals))!=len(channel.metals):
                raise ValueError(f'invalid routing channel die/metals: {channel.id}')
            if any(not any(m.name==name and m.direction==channel.direction for m in self.resources.metals) for name in channel.metals):
                raise ValueError(f'invalid routing channel metal direction/name: {channel.id}')
            for link_id in channel.links:
                if link_id not in {l.id for l in a.links} or link_id in bound_links:
                    raise ValueError(f'unknown or multiply bound channel link: {link_id}')
                bound_links.add(link_id)
        unique([p.module for p in self.floorplan.placements], "placement")
        for p in self.floorplan.placements:
            if p.module not in ms or p.die not in ds:
                raise ValueError("unknown placement module/die")
            m = ms[p.module]
            if not math.isclose(p.width_um, m.width_um) or not math.isclose(p.height_um, m.height_um):
                raise ValueError(f"placement dimensions must match module {m.id}")
        for r in self.floorplan.tsv_regions:
            if r.lower_die not in ds or r.upper_die not in ds or ds[r.upper_die].order - ds[r.lower_die].order != 1:
                raise ValueError("TSV region must join adjacent ordered dies")
            if r.core is not None and r.core not in cs:
                raise ValueError(f"unknown TSV region core: {r.id}")
        for b in self.constraints.blockages:
            if b.die not in ds:
                raise ValueError("unknown blockage die")
        for p in self.floorplan.supply_ports:
            if p.core is not None and p.core not in {c.id for c in a.cores}:
                raise ValueError('unknown supply port core')
            if p.die not in ds:
                raise ValueError("unknown supply port die")
            if not math.isclose(p.voltage_V, ds[p.die].voltage_V):
                raise ValueError("v0.1 supply voltage must match die voltage")
            if p.feed == "stack_base" and ds[p.die].order == 0:
                raise ValueError("base die must be fed externally")
        for d in ds:
            for domain in {p.domain for p in self.floorplan.supply_ports if p.die == d}:
                if len({p.feed for p in self.floorplan.supply_ports if p.die == d and p.domain == domain}) > 1:
                    raise ValueError("mixed external/stack supply for one die domain is unsupported")
        for g in self.constraints.same_die_groups:
            if not set(g) <= ms.keys():
                raise ValueError("unknown module in same-die group")
        if self.search.objective == 'latency' and self.resources.delay_model is None:
            raise ValueError('latency objective requires an explicit delay_model')
        for die in a.dies:
            for domain in {p.domain for p in self.floorplan.supply_ports if p.die == die.id}:
                ports = [p for p in self.floorplan.supply_ports if p.die == die.id and p.domain == domain]
                if any(p.core is None for p in ports) and any(p.core is not None for p in ports):
                    raise ValueError('cannot mix shared and core-owned supply ports in one die/domain')
        return self


def loads(text: str) -> Project:
    if len(text.encode("utf-8")) > 4_000_000:
        raise ValueError("YAML exceeds 4 MB")
    yaml = YAML(typ="safe")
    yaml.allow_duplicate_keys = False
    return Project.model_validate(yaml.load(text))


def dumps(value) -> str:
    yaml = YAML()
    yaml.default_flow_style = False
    stream = io.StringIO()
    yaml.dump(value.model_dump() if isinstance(value, BaseModel) else value, stream)
    return stream.getvalue()
