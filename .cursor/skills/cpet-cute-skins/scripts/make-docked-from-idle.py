#!/usr/bin/env python3
"""Build left/right docked GIFs/PNGs from idle.

Geometry (must match app):
  - Mascot displays at 140×140 inside a 280-wide window
  - Collapsed dock peeks ~72px (about half the mascot)
  - Window clips the off-screen half — art should stay *normal framing*
    (do NOT pre-slice / overhang into a 40px strip; that looks like a huge face bar)

  docked-right / docked: same facing as idle (typically into desktop from right edge)
  docked-left: horizontal mirror so face still looks into the desktop from the left edge
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent / "lib"))
from cpet_paths import SKINS, describe_paths  # noqa: E402

import numpy as np  # noqa: E402
from PIL import Image  # noqa: E402

# Legacy packs from the cursor-pet repo; discover_packs() adds whatever is local.
PACKS: dict[str, str] = {
    "奶油包子": "idle.gif",
    "赛博幽灵": "idle.gif",
    "手账水彩": "idle.gif",
    "代码小精灵": "idle.gif",
    "布布嘟嘟": "idle.gif",
    "黄油小熊": "idle.gif",
    "示例包": "idle.png",
    "cuppy表情包": "idle.png",
}


def discover_packs() -> dict[str, str]:
    """Merge PACKS with any skin.json packName that has idle.gif/png."""
    out = dict(PACKS)
    work = SKINS / "_work"
    if work.is_dir():
        for p in work.iterdir():
            sj = p / "skin.json"
            if not sj.exists():
                continue
            try:
                import json

                data = json.loads(sj.read_text(encoding="utf-8"))
                name = data.get("packName")
                if not name:
                    continue
                pack = SKINS / name
                idle = "idle.gif" if (pack / "idle.gif").exists() else "idle.png"
                if (pack / idle).exists():
                    out[name] = idle
            except Exception:
                continue
    return out


def load_frames(path: Path) -> tuple[list[Image.Image], list[int]]:
    im = Image.open(path)
    frames: list[Image.Image] = []
    durs: list[int] = []
    n = getattr(im, "n_frames", 1)
    for i in range(n):
        im.seek(i)
        frames.append(im.convert("RGBA").copy())
        durs.append(int(im.info.get("duration") or 120))
    return frames, durs


def compose_dock(frame: Image.Image, edge: str) -> Image.Image:
    """Keep idle framing; only mirror for left edge."""
    out = frame.convert("RGBA")
    if edge == "left":
        out = out.transpose(Image.Transpose.FLIP_LEFT_RIGHT)
    elif edge != "right":
        raise ValueError(edge)
    return out


def save_gif(frames: list[Image.Image], path: Path, durations: list[int]) -> None:
    converted: list[Image.Image] = []
    for fr in frames:
        arr = np.asarray(fr.convert("RGBA"))
        opaque = arr[..., 3] >= 128
        rgb = arr[..., :3].copy()
        rgb[~opaque] = (0, 0, 0)
        base = Image.fromarray(rgb)
        pal = base.quantize(colors=255, method=Image.Quantize.FASTOCTREE, dither=Image.Dither.NONE)
        palette = list(pal.getpalette()[: 255 * 3])
        new_pal = [0, 0, 0] + palette
        while len(new_pal) < 768:
            new_pal += [0, 0, 0]
        idx = np.clip(np.asarray(pal, dtype=np.uint16) + 1, 1, 255).astype(np.uint8)
        idx[~opaque] = 0
        out = Image.fromarray(idx, mode="P")
        out.putpalette(new_pal[:768])
        out.info["transparency"] = 0
        converted.append(out)

    while len(durations) < len(converted):
        durations.append(durations[-1] if durations else 120)
    converted[0].save(
        path,
        save_all=True,
        append_images=converted[1:],
        duration=durations[: len(converted)],
        loop=0,
        disposal=2,
        transparency=0,
        optimize=False,
    )


def process_pack(name: str, idle_name: str) -> None:
    pack = SKINS / name
    idle = pack / idle_name
    if not idle.exists():
        print("skip missing", idle)
        return

    frames, durs = load_frames(idle)
    is_gif = idle.suffix.lower() == ".gif"
    variants = {
        "docked-right": [compose_dock(f, "right") for f in frames],
        "docked-left": [compose_dock(f, "left") for f in frames],
    }
    variants["docked"] = variants["docked-right"]

    for key, frs in variants.items():
        if is_gif:
            out = pack / f"{key}.gif"
            save_gif(frs, out, list(durs))
        else:
            out = pack / f"{key}.png"
            frs[0].save(out)
        print("wrote", out)

    for stale in pack.glob("docked-top.*"):
        stale.unlink(missing_ok=True)
        print("removed", stale)


def main() -> None:
    catalog = discover_packs()
    only = [a for a in sys.argv[1:] if not a.startswith("-")]
    if only:
        items = {}
        for name in only:
            if name in catalog:
                items[name] = catalog[name]
            elif (SKINS / name / "idle.gif").exists():
                items[name] = "idle.gif"
            elif (SKINS / name / "idle.png").exists():
                items[name] = "idle.png"
            else:
                raise SystemExit(f"unknown pack {name} (no {SKINS / name}/idle.gif|png)\n{describe_paths()}")
    else:
        items = catalog
    for name, idle_name in items.items():
        process_pack(name, idle_name)
    print("done")


if __name__ == "__main__":
    main()
