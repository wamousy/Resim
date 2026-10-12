"""Extract explicit routing geometry and cell area from LEF, with source hashes."""
import hashlib
import re
from pathlib import Path


def import_lef(tech_path, cells_path):
    tech = Path(tech_path).read_text(encoding="utf-8")
    cells = Path(cells_path).read_text(encoding="utf-8")
    metals = []
    for name, body in re.findall(r"^LAYER\s+(\S+)\s*\n(.*?)^END\s+\1\s*$", tech, re.M | re.S):
        if not re.search(r"TYPE\s+ROUTING\s*;", body):
            continue
        def field(key):
            if key == "WIDTH":
                scalar = re.search(r"^[ \t]*WIDTH[ \t]+([\d.]+)[ \t]*;", body, re.M)
                if scalar:
                    return scalar.group(1)
                raise ValueError(f"missing scalar WIDTH for {name}")
            found = re.search(rf"^[ \t]*{key}[ \t]+([^;\r\n]+);", body, re.M)
            if not found:
                raise ValueError(f"missing {key} for {name}")
            return found.group(1).strip()
        pitches = field("PITCH").split()
        # Anisotropic pitches are conservatively reduced to the larger pitch.
        metals.append(dict(name=name, direction=field("DIRECTION"), pitch_um=max(map(float, pitches)), width_um=float(field("WIDTH"))))
    areas = {}
    for name, body in re.findall(r"^MACRO\s+(\S+)\s*\n(.*?)^END\s+\1\s*$", cells, re.M | re.S):
        match = re.search(r"SIZE\s+([\d.]+)\s+BY\s+([\d.]+)\s*;", body)
        if match:
            w, h = map(float, match.groups())
            areas[name] = dict(width_um=w, height_um=h, area_um2=w*h)
    if not metals or not areas:
        raise ValueError("LEF import did not find routing layers and cell sizes")
    return {"metals": metals, "cells": areas, "source_sha256": {Path(p).name: hashlib.sha256(Path(p).read_bytes()).hexdigest() for p in [tech_path, cells_path]}}
