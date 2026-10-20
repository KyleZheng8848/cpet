#!/usr/bin/env python3
"""Validate CPET image-skin packs.

Checks:
  - lifecycle files present
  - docked left/right mirror + normal framing
  - optional --strict-actions: all ACTION_CATALOG stems present
  - identity gate: each stem similar to idle (fail-closed)
  - reserved-name collision for action files

Usage:
  cpet validate --strict-actions 草莓布丁
  python3 <skill>/scripts/validate-cute-skins.py --strict-actions 草莓布丁
  python3 <skill>/scripts/validate-cute-skins.py --legacy 奶油包子
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent / "lib"))
from cpet_paths import SKINS, catalog_path as _catalog, describe_paths  # noqa: E402

import numpy as np  # noqa: E402
from PIL import Image  # noqa: E402

# Legacy packs from the cursor-pet repo; only used when no pack is named.
DEFAULT_PACKS = [
    "奶油包子",
    "赛博幽灵",
    "手账水彩",
    "代码小精灵",
    "布布嘟嘟",
    "黄油小熊",
]


def load_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def lifecycle_ids() -> list[str]:
    return [s["id"] for s in load_json(_catalog("LIFECYCLE.json"))["states"]]


def action_ids() -> list[str]:
    return [a["id"] for a in load_json(_catalog("ACTION_CATALOG.json"))["actions"]]


def reserved() -> set[str]:
    return {s.lower() for s in load_json(_catalog("LIFECYCLE.json"))["reserved"]}


def eyes_closed_ids() -> set[str]:
    closed = set()
    for s in load_json(_catalog("LIFECYCLE.json"))["states"]:
        if s.get("eyesClosed"):
            closed.add(s["id"])
    for a in load_json(_catalog("ACTION_CATALOG.json"))["actions"]:
        if a.get("eyesClosed"):
            closed.add(a["id"])
    return closed


def find_asset(pack: Path, stem: str) -> Path | None:
    for ext in (".gif", ".png", ".webp", ".apng"):
        p = pack / f"{stem}{ext}"
        if p.exists():
            return p
    return None


def first_frame(path: Path) -> Image.Image:
    im = Image.open(path)
    im.seek(0)
    return im.convert("RGBA")


def opaque_mask(arr: np.ndarray, thr: int = 16) -> np.ndarray:
    return arr[..., 3] >= thr


def stats(im: Image.Image) -> dict:
    arr = np.asarray(im)
    m = opaque_mask(arr)
    if not m.any():
        return {"empty": True}
    ys, xs = np.where(m)
    rgb = arr[..., :3]
    mag = m & (rgb[..., 0] > 200) & (rgb[..., 2] > 200) & (rgb[..., 1] < 80)
    return {
        "empty": False,
        "cx": float(xs.min() + xs.max()) / 2,
        "cy": float(ys.min() + ys.max()) / 2,
        "magenta": int(mag.sum()),
        "w": im.size[0],
        "h": im.size[1],
        "mask": m,
        "arr": arr,
    }


def ahash(arr: np.ndarray, size: int = 8) -> np.ndarray:
    """Average hash on opaque-composited RGB (white bg)."""
    m = opaque_mask(arr)
    rgb = arr[..., :3].copy()
    rgb[~m] = 255
    im = Image.fromarray(rgb).convert("L").resize((size, size), Image.Resampling.BILINEAR)
    pix = np.asarray(im, dtype=np.float32)
    return pix > pix.mean()


def color_hist(arr: np.ndarray, bins: int = 16) -> np.ndarray:
    m = opaque_mask(arr)
    if not m.any():
        return np.zeros(bins * 3, dtype=np.float32)
    pix = arr[..., :3][m].astype(np.float32)
    hs = []
    for c in range(3):
        h, _ = np.histogram(pix[:, c], bins=bins, range=(0, 256), density=True)
        hs.append(h.astype(np.float32))
    v = np.concatenate(hs)
    n = np.linalg.norm(v)
    return v / n if n > 1e-8 else v


def silhouette_iou(a: np.ndarray, b: np.ndarray) -> float:
    """IoU of centered binary silhouettes at 64×64."""

    def sil(arr: np.ndarray) -> np.ndarray:
        m = opaque_mask(arr)
        if not m.any():
            return np.zeros((64, 64), dtype=bool)
        ys, xs = np.where(m)
        crop = m[ys.min() : ys.max() + 1, xs.min() : xs.max() + 1]
        im = Image.fromarray((crop.astype(np.uint8) * 255)).resize((64, 64), Image.Resampling.NEAREST)
        return np.asarray(im) > 127

    A, B = sil(a), sil(b)
    inter = np.logical_and(A, B).sum()
    union = np.logical_or(A, B).sum()
    return float(inter) / float(union) if union else 0.0


def identity_score(idle_arr: np.ndarray, other_arr: np.ndarray, eyes_closed: bool) -> dict:
    h_idle = ahash(idle_arr)
    h_other = ahash(other_arr)
    ham = int(np.bitwise_xor(h_idle, h_other).sum())
    cos = float(np.dot(color_hist(idle_arr), color_hist(other_arr)))
    iou = silhouette_iou(idle_arr, other_arr)
    # thresholds: fail-closed but allow pose/expression change
    if eyes_closed:
        ok = iou >= 0.28 and cos >= 0.82
    else:
        ok = ham <= 22 and iou >= 0.30 and cos >= 0.85
    return {"ok": ok, "ham": ham, "cos": round(cos, 3), "iou": round(iou, 3)}


def check_pack(name: str, *, strict_actions: bool, check_identity: bool) -> list[str]:
    pack = SKINS / name
    errs: list[str] = []
    if not pack.is_dir():
        return [f"{name}: missing pack directory {pack}"]

    # reserved collision among non-lifecycle files
    res = reserved()
    life = set(lifecycle_ids())
    for f in pack.iterdir():
        if not f.is_file():
            continue
        stem = f.stem.lower()
        if stem in res and stem not in life and not stem.startswith("docked"):
            # e.g. someone named an action "working"
            pass
    for aid in action_ids():
        if aid.lower() in res:
            errs.append(f"catalog reserved collision: {aid}")

    idle_path = find_asset(pack, "idle")
    if not idle_path:
        errs.append(f"{name}: missing idle")
        return errs
    idle_arr = np.asarray(first_frame(idle_path))
    closed = eyes_closed_ids()

    for stem in lifecycle_ids():
        p = find_asset(pack, stem)
        if not p:
            errs.append(f"{name}: missing {stem}.gif/png")
            continue
        st = stats(first_frame(p))
        if st.get("empty"):
            errs.append(f"{name}/{stem}: empty")
            continue
        if st["magenta"] > 80:
            errs.append(f"{name}/{stem}: magenta fringe")
        if check_identity and stem != "idle":
            sc = identity_score(idle_arr, st["arr"], stem in closed)
            if not sc["ok"]:
                errs.append(
                    f"{name}/{stem}: identity drift vs idle "
                    f"(ham={sc['ham']} cos={sc['cos']} iou={sc['iou']})"
                )

    if strict_actions:
        for stem in action_ids():
            p = find_asset(pack, stem)
            if not p:
                errs.append(f"{name}: missing action {stem}.gif/png")
                continue
            st = stats(first_frame(p))
            if st.get("empty"):
                errs.append(f"{name}/{stem}: empty")
                continue
            if st["magenta"] > 80:
                errs.append(f"{name}/{stem}: magenta fringe")
            if check_identity:
                sc = identity_score(idle_arr, st["arr"], stem in closed)
                if not sc["ok"]:
                    errs.append(
                        f"{name}/{stem}: identity drift vs idle "
                        f"(ham={sc['ham']} cos={sc['cos']} iou={sc['iou']})"
                    )

    # docked
    right_path = find_asset(pack, "docked-right") or find_asset(pack, "docked")
    left_path = find_asset(pack, "docked-left")
    if not right_path:
        errs.append(f"{name}: missing docked.gif / docked-right")
    if not left_path:
        errs.append(f"{name}: missing docked-left")
    if right_path and left_path:
        R = stats(first_frame(right_path))
        L = stats(first_frame(left_path))
        if not R.get("empty") and not L.get("empty"):
            if L["mask"].shape == R["mask"].shape:
                overlap = float((L["mask"] == R["mask"][:, ::-1]).mean())
                if overlap < 0.92:
                    errs.append(f"{name}: docked-left should mirror docked-right (overlap={overlap:.2f})")
            mid = R["w"] / 2
            if abs(R["cx"] - mid) > mid * 0.35:
                errs.append(f"{name}/docked-right: unexpected pre-crop (cx={R['cx']:.0f})")
            if abs(L["cx"] - mid) > mid * 0.35:
                errs.append(f"{name}/docked-left: unexpected pre-crop (cx={L['cx']:.0f})")

    return errs


def main() -> None:
    args = [a for a in sys.argv[1:]]
    strict = "--strict-actions" in args
    legacy = "--legacy" in args
    # New packs: --strict-actions implies identity gate. Opt-in alone: --identity.
    # Legacy default: files + docked only (old packs vary props/colors heavily).
    check_identity = "--identity" in args or strict
    packs = [a for a in args if not a.startswith("-")]
    if not packs:
        packs = DEFAULT_PACKS
        if not strict:
            legacy = True
    if legacy:
        strict = False
        check_identity = "--identity" in args

    all_errs: list[str] = []
    mode = []
    mode.append("strict-actions" if strict else "lifecycle")
    mode.append("identity" if check_identity else "no-identity")
    print("mode=" + "+".join(mode))
    print(f"skins={SKINS}")
    for name in packs:
        errs = check_pack(name, strict_actions=strict, check_identity=check_identity)
        if errs:
            all_errs.extend(errs)
            print(f"FAIL {name} ({len(errs)})")
            for e in errs:
                print(f"  - {e}")
        else:
            print(f"OK   {name}")
    if all_errs:
        print(f"\n{len(all_errs)} issue(s)")
        print(describe_paths())
        raise SystemExit(1)
    print("\nall packs ok")


if __name__ == "__main__":
    main()
