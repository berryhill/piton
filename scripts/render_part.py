#!/usr/bin/env python3
"""Render orthographic + isometric PNG previews of the Stage 1 L-bracket.

Uses build123d's Drawing class (HLR-based) to project the 3D Part onto
2D planes, exports to SVG, then converts to PNG via cairosvg.

Views:
  --view front   front orthographic (looking down -Z)
  --view top     top orthographic (looking down -Y)
  --view side    side orthographic (looking down -X)
  --view iso     isometric (1, -1, 1)

Output: dist/l_bracket_default_<view>.png
"""
from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))

from build123d import (
    Color,
    ColorIndex,
    LineType,
    Unit,
    Vector,
)
from build123d.exporters import Drawing, ExportSVG

from piton.parts.l_bracket import DEFAULT_PARAMETERS, build_l_bracket


VIEWS = {
    "front": {"look_at": (60, 44, 0),  "look_from": (0, 0, -300),  "look_up": (1, 0, 0)},
    "top":   {"look_at": (60, 0, 0),    "look_from": (0, -300, 0),  "look_up": (1, 0, 0)},
    "side":  {"look_at": (0, 44, 0),    "look_from": (-300, 0, 0),  "look_up": (0, 1, 0)},
    "iso":   {"look_at": (60, 44, 0),   "look_from": (200, -200, 200), "look_up": (0, 0, 1)},
}


def render_view(part, view_name: str, out_svg: Path, out_png: Path | None) -> dict:
    cfg = VIEWS[view_name]
    drawing = Drawing(
        part,
        look_at=cfg["look_at"],
        look_from=cfg["look_from"],
        look_up=cfg["look_up"],
    )

    exporter = ExportSVG(unit=Unit.MM, margin=5, line_weight=0.2)
    exporter.add_layer("visible", line_color=ColorIndex.BLACK, line_weight=0.3)
    exporter.add_layer("hidden", line_color=Color(0.6, 0.6, 0.6), line_type=LineType.DASHED)
    for edge in drawing.visible_lines.edges():
        exporter.add_shape(edge, layer="visible")
    for edge in drawing.hidden_lines.edges():
        exporter.add_shape(edge, layer="hidden")
    exporter.write(str(out_svg))

    png_size = None
    if out_png is not None and shutil.which("cairosvg"):
        subprocess.run(
            ["cairosvg", str(out_svg), "-o", str(out_png), "-W", "1400", "-H", "1000"],
            check=True,
        )
        png_size = out_png.stat().st_size

    return {
        "view": view_name,
        "svg": str(out_svg),
        "svg_bytes": out_svg.stat().st_size,
        "png": str(out_png) if out_png else None,
        "png_bytes": png_size,
        "visible_edges": len(list(drawing.visible_lines.edges())),
        "hidden_edges": len(list(drawing.hidden_lines.edges())),
    }


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--view", choices=[*VIEWS.keys(), "all"], default="all")
    p.add_argument("--out-dir", type=Path, default=Path("dist"))
    args = p.parse_args()

    part = build_l_bracket(DEFAULT_PARAMETERS)
    args.out_dir.mkdir(parents=True, exist_ok=True)

    views = list(VIEWS.keys()) if args.view == "all" else [args.view]
    results = []
    for v in views:
        svg = args.out_dir / f"l_bracket_default_{v}.svg"
        png = args.out_dir / f"l_bracket_default_{v}.png"
        info = render_view(part, v, svg, png)
        results.append(info)

    print(json.dumps({"renders": results}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())