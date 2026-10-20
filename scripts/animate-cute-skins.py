#!/usr/bin/env python3
"""Assemble CPET cute-skin GIFs — hard-cut flipbook from CLEAN keyframes.

Strategy (2026-07 rewrite):
- 已授权的出图工具 has no I2V/GIF; OpenClaw video providers empty.
- AI "animation beat" stills often bake double-exposure / ghost eyes into ONE png.
- So we use the clean original raw per state, then paint deterministic pose
  variants (blink / mouth / ear tip) on the matted cutout — never alpha-blend
  two full frames, never whole-image mesh warp.

Output: 280×280 transparent GIF, disposal=2, transparency index 0.
"""

from __future__ import annotations

import json
import sys
from collections import deque
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
WORK = ROOT / "assets/skins/_work"
OUT = ROOT / "assets/skins"

SIZE = 280
TRANSPARENT = (0, 0, 0, 0)

# Legacy aliases (skin.json preferred)
STYLES = {
    "cream-bun": "奶油包子",
    "cyber-ghost": "赛博幽灵",
    "sticker-ink": "手账水彩",
    "code-sprite": "代码小精灵",
}


def _catalog_path(name: str) -> Path:
    primary = OUT / name
    if primary.exists():
        return primary
    bundled = ROOT / ".cursor/skills/cpet-cute-skins/catalogs" / name
    if bundled.exists():
        return bundled
    raise FileNotFoundError(name)


def _load_stems() -> list[str]:
    life = json.loads(_catalog_path("LIFECYCLE.json").read_text(encoding="utf-8"))
    actions = json.loads(_catalog_path("ACTION_CATALOG.json").read_text(encoding="utf-8"))
    stems = [s["id"] for s in life["states"]]
    stems += [a["id"] for a in actions["actions"]]
    return stems


STATES = _load_stems()  # lifecycle + 20 actions (no docked — use make-docked-from-idle)


def resolve_skin(arg: str) -> tuple[str, str]:
    """Return (work_id, pack_name). Prefers skin.json."""
    skin_json = WORK / arg / "skin.json"
    if skin_json.exists():
        data = json.loads(skin_json.read_text(encoding="utf-8"))
        return data["id"], data["packName"]
    if arg in STYLES:
        return arg, STYLES[arg]
    # pack name → find work id
    for p in WORK.iterdir():
        sj = p / "skin.json"
        if sj.exists():
            data = json.loads(sj.read_text(encoding="utf-8"))
            if data.get("packName") == arg or data.get("id") == arg:
                return data["id"], data["packName"]
    raise SystemExit(f"unknown skin {arg!r} (need assets/skins/_work/<id>/skin.json)")


def list_skins() -> list[str]:
    ids = []
    if WORK.exists():
        for p in sorted(WORK.iterdir()):
            if (p / "skin.json").exists():
                ids.append(p.name)
    return ids or list(STYLES.keys())


def flatten_fake_bg(im: Image.Image) -> Image.Image:
    """Turn baked-in checkerboard / dark / gray backdrops into flat white for flood matte."""
    im = im.convert("RGBA")
    arr = np.asarray(im).copy()
    rgb = arr[..., :3].astype(np.float32)
    h, w = rgb.shape[:2]
    n = min(48, h // 4, w // 4)
    if n < 8:
        return im
    corners = np.concatenate(
        [
            rgb[:n, :n].reshape(-1, 3),
            rgb[:n, -n:].reshape(-1, 3),
            rgb[-n:, :n].reshape(-1, 3),
            rgb[-n:, -n:].reshape(-1, 3),
        ],
        axis=0,
    )
    sat = float((corners.max(axis=1) - corners.min(axis=1)).mean())
    std = float(corners.std(axis=0).mean())
    lum_c = 0.299 * corners[:, 0] + 0.587 * corners[:, 1] + 0.114 * corners[:, 2]
    mean_lum = float(lum_c.mean())

    if mean_lum >= 245 and std <= 14 and sat < 20:
        return im

    is_checker = sat < 28 and std > 16 and mean_lum > 90
    is_dark = sat < 40 and mean_lum < 200
    is_grayish = sat < 35 and mean_lum < 245
    if not (is_checker or is_dark or is_grayish):
        return im

    if is_checker:
        light = corners[lum_c >= np.median(lum_c)].mean(axis=0)
        dark = corners[lum_c < np.median(lum_c)].mean(axis=0)
        dist_l = np.max(np.abs(rgb - light.reshape(1, 1, 3)), axis=2)
        dist_d = np.max(np.abs(rgb - dark.reshape(1, 1, 3)), axis=2)
        sat_map = rgb.max(axis=2) - rgb.min(axis=2)
        bgish = ((dist_l <= 38) | (dist_d <= 38)) & (sat_map < 45)
    else:
        ref = np.median(corners, axis=0)
        dist = np.max(np.abs(rgb - ref.reshape(1, 1, 3)), axis=2)
        sat_map = rgb.max(axis=2) - rgb.min(axis=2)
        tol = 55 if mean_lum < 120 else 42
        bgish = (dist <= tol) & (sat_map < 45)

    visited = np.zeros((h, w), dtype=bool)
    q: deque[tuple[int, int]] = deque()
    for x in range(w):
        for y in (0, h - 1):
            if bgish[y, x]:
                visited[y, x] = True
                q.append((y, x))
    for y in range(h):
        for x in (0, w - 1):
            if not visited[y, x] and bgish[y, x]:
                visited[y, x] = True
                q.append((y, x))
    while q:
        y, x = q.popleft()
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            ny, nx = y + dy, x + dx
            if 0 <= ny < h and 0 <= nx < w and not visited[ny, nx] and bgish[ny, nx]:
                visited[ny, nx] = True
                q.append((ny, nx))
    rgb[visited] = 255.0
    arr[..., :3] = rgb.astype(np.uint8)
    return Image.fromarray(arr)


def edge_flood_matte(im: Image.Image, tol: int = 20, soft: int = 12) -> Image.Image:
    im = flatten_fake_bg(im).convert("RGBA")
    arr = np.asarray(im).copy()
    h, w = arr.shape[:2]
    rgb = arr[..., :3].astype(np.float32)
    border = np.concatenate([rgb[0], rgb[-1], rgb[:, 0], rgb[:, -1]], axis=0)
    lum = 0.299 * border[:, 0] + 0.587 * border[:, 1] + 0.114 * border[:, 2]
    bright = border[lum >= np.percentile(lum, 30)]
    ref = np.median(bright if len(bright) >= 8 else border, axis=0)
    dist = np.max(np.abs(rgb - ref.reshape(1, 1, 3)), axis=2)

    visited = np.zeros((h, w), dtype=bool)
    q: deque[tuple[int, int]] = deque()
    seed_tol = tol + 10
    for x in range(w):
        for y in (0, h - 1):
            if dist[y, x] <= seed_tol:
                visited[y, x] = True
                q.append((y, x))
    for y in range(h):
        for x in (0, w - 1):
            if not visited[y, x] and dist[y, x] <= seed_tol:
                visited[y, x] = True
                q.append((y, x))
    while q:
        y, x = q.popleft()
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            ny, nx = y + dy, x + dx
            if 0 <= ny < h and 0 <= nx < w and not visited[ny, nx] and dist[ny, nx] <= tol:
                visited[ny, nx] = True
                q.append((ny, nx))

    alpha = np.full((h, w), 255.0, dtype=np.float32)
    alpha[visited] = 0.0
    a = np.clip(alpha / 255.0, 0, 1)
    partial = (a > 0.02) & (a < 0.97)
    if partial.any():
        fg = (rgb - (1.0 - a)[..., None] * ref.reshape(1, 1, 3)) / np.maximum(a[..., None], 1e-3)
        rgb = rgb.copy()
        rgb[partial] = np.clip(fg[partial], 0, 255)

    hard = alpha >= 120
    exterior = np.zeros((h, w), dtype=bool)
    q = deque()
    for y, x in ((0, 0), (0, w - 1), (h - 1, 0), (h - 1, w - 1)):
        if not hard[y, x]:
            exterior[y, x] = True
            q.append((y, x))
    while q:
        y, x = q.popleft()
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            ny, nx = y + dy, x + dx
            if 0 <= ny < h and 0 <= nx < w and not exterior[ny, nx] and not hard[ny, nx]:
                exterior[ny, nx] = True
                q.append((ny, nx))
    alpha[(~hard) & (~exterior)] = 255.0

    # strip outer near-white halo
    near_w = (rgb[..., 0] > 246) & (rgb[..., 1] > 246) & (rgb[..., 2] > 246) & (alpha > 0)
    ext = alpha < 16
    dil = ext.copy()
    for _ in range(4):
        n = dil.copy()
        n[1:] |= dil[:-1]
        n[:-1] |= dil[1:]
        n[:, 1:] |= dil[:, :-1]
        n[:, :-1] |= dil[:, 1:]
        dil = n
    alpha[near_w & dil] = 0

    out = np.dstack([rgb.astype(np.uint8), np.clip(alpha, 0, 255).astype(np.uint8)])
    im_out = Image.fromarray(out)
    aa = np.asarray(im_out.getchannel("A").filter(ImageFilter.GaussianBlur(0.4))).astype(np.float32)
    aa[aa < 30] = 0
    aa[aa > 245] = 255
    im_out.putalpha(Image.fromarray(aa.astype(np.uint8)))
    bbox = im_out.getbbox()
    if bbox:
        x0, y0, x1, y1 = bbox
        im_out = im_out.crop((max(0, x0 - 1), max(0, y0 - 1), min(w, x1 + 1), min(h, y1 + 1)))
    return im_out


def matte(im: Image.Image) -> Image.Image:
    im = flatten_fake_bg(im)
    # rembg only if a complete local model is already present (avoid hung downloads)
    model = Path.home() / ".u2net" / "u2netp.onnx"
    if model.exists() and model.stat().st_size > 4_000_000:
        try:
            from rembg import remove, new_session

            sess = new_session("u2netp")
            cut = remove(im.convert("RGBA"), session=sess)
            if not isinstance(cut, Image.Image):
                from io import BytesIO

                cut = Image.open(BytesIO(cut)).convert("RGBA")
            else:
                cut = cut.convert("RGBA")
            arr = np.asarray(cut).copy()
            a = arr[..., 3].astype(np.float32)
            a[a < 28] = 0
            a[a > 240] = 255
            arr[..., 3] = a.astype(np.uint8)
            cut = Image.fromarray(arr)
            bbox = cut.getbbox()
            if bbox:
                cut = cut.crop(bbox)
            return cut
        except Exception:
            pass
    return edge_flood_matte(im)


def fit_square(im: Image.Image, size: int = SIZE, pad_ratio: float = 0.08) -> Image.Image:
    im = im.convert("RGBA")
    w, h = im.size
    target = int(size * (1 - pad_ratio * 2))
    scale = min(target / w, target / h)
    nw, nh = max(1, int(w * scale)), max(1, int(h * scale))
    im = im.resize((nw, nh), Image.Resampling.LANCZOS)
    canvas = Image.new("RGBA", (size, size), TRANSPARENT)
    canvas.paste(im, ((size - nw) // 2, (size - nh) // 2), im)
    return canvas


def harden_alpha(im: Image.Image, cut: int = 110) -> Image.Image:
    arr = np.asarray(im.convert("RGBA")).copy()
    arr[..., 3] = np.where(arr[..., 3] >= cut, 255, 0).astype(np.uint8)
    return Image.fromarray(arr)


def _bbox(arr: np.ndarray) -> tuple[int, int, int, int]:
    ys, xs = np.where(arr[..., 3] >= 128)
    if len(xs) == 0:
        h, w = arr.shape[:2]
        return 0, 0, w, h
    return int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1


def clean_sprite(im: Image.Image) -> Image.Image:
    """Drop debris / floor crumbs / speed lines; soften AI scanline grain."""
    arr = np.asarray(im.convert("RGBA")).copy()
    h, w = arr.shape[:2]
    a = arr[..., 3] >= 128
    visited = np.zeros((h, w), dtype=bool)
    keep = np.zeros((h, w), dtype=bool)
    ys, xs = np.where(a)
    comps: list[list[tuple[int, int]]] = []
    for y, x in zip(ys.tolist(), xs.tolist()):
        if visited[y, x]:
            continue
        q = deque([(y, x)])
        visited[y, x] = True
        pts: list[tuple[int, int]] = []
        while q:
            cy, cx = q.popleft()
            pts.append((cy, cx))
            for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                ny, nx = cy + dy, cx + dx
                if 0 <= ny < h and 0 <= nx < w and a[ny, nx] and not visited[ny, nx]:
                    visited[ny, nx] = True
                    q.append((ny, nx))
        comps.append(pts)
    comps.sort(key=len, reverse=True)
    if not comps:
        return im

    main = comps[0]
    main_n = len(main)
    main_ys = [p[0] for p in main]
    main_xs = [p[1] for p in main]
    main_y1 = max(main_ys)
    main_x0, main_x1 = min(main_xs), max(main_xs)

    for pts in comps:
        ys_ = [p[0] for p in pts]
        xs_ = [p[1] for p in pts]
        hh = max(ys_) - min(ys_) + 1
        ww = max(xs_) - min(xs_) + 1
        # drop tiny crumbs
        if len(pts) < max(40, int(main_n * 0.004)):
            continue
        # drop thin horizontal floor/shadow slivers under the feet
        if (
            min(ys_) >= main_y1 - 6
            and hh <= 5
            and ww >= max(12, int((main_x1 - main_x0) * 0.15))
        ):
            continue
        for y, x in pts:
            keep[y, x] = True
    arr[~keep, 3] = 0

    # carve bottom white sticker/shadow shelf (often a jagged horizontal bar)
    opaque = arr[..., 3] >= 128
    if opaque.any():
        ys_o, xs_o = np.where(opaque)
        y0m, y1m = int(ys_o.min()), int(ys_o.max())
        x0m, x1m = int(xs_o.min()), int(xs_o.max())
        rgb = arr[..., :3].astype(np.float32)
        near_w = (rgb[..., 0] > 220) & (rgb[..., 1] > 220) & (rgb[..., 2] > 220)
        # peel bottom ~3% of sprite height: white pixels with empty below → drop
        peel = max(3, int((y1m - y0m) * 0.035))
        for y in range(y1m, max(y0m, y1m - peel) - 1, -1):
            row = (arr[y, :, 3] >= 128) & near_w[y]
            if not row.any():
                continue
            below = arr[min(h - 1, y + 1), :, 3] < 16
            # also drop if mostly a thin bar (few dark outline pixels on this row)
            dark = (arr[y, :, 3] >= 128) & (rgb[y, :, 0] < 90) & (rgb[y, :, 1] < 90) & (rgb[y, :, 2] < 110)
            if dark.sum() < max(6, row.sum() // 8):
                arr[y, row & below, 3] = 0
                # if almost entire remaining row is white shelf, clear it
                still = arr[y, :, 3] >= 128
                still_w = still & near_w[y]
                if still.any() and still_w.sum() >= int(still.sum() * 0.65):
                    arr[y, still_w, 3] = 0
        # second pass: isolated near-white islands in bottom band
        band_y0 = y1m - peel - 2
        for y in range(max(0, band_y0), min(h, y1m + 1)):
            for x in range(max(0, x0m - 2), min(w, x1m + 3)):
                if arr[y, x, 3] < 128 or not near_w[y, x]:
                    continue
                # count opaque neighbors
                y0n, y1n = max(0, y - 1), min(h, y + 2)
                x0n, x1n = max(0, x - 1), min(w, x + 2)
                neigh = arr[y0n:y1n, x0n:x1n, 3] >= 128
                if neigh.sum() <= 3:
                    arr[y, x, 3] = 0

    # vertical-aware despeckle: kill 1px horizontal scanline grain
    opaque = arr[..., 3] >= 128
    rgb = arr[..., :3].astype(np.float32)
    up_rgb = np.vstack([rgb[0:1], rgb[:-1]])
    dn_rgb = np.vstack([rgb[1:], rgb[-1:]])
    lum = 0.299 * rgb[..., 0] + 0.587 * rgb[..., 1] + 0.114 * rgb[..., 2]
    up_l = np.vstack([lum[0:1], lum[:-1]])
    dn_l = np.vstack([lum[1:], lum[-1:]])
    fix = opaque & ((np.abs(lum - up_l) + np.abs(lum - dn_l)) > 28) & (np.abs(up_l - dn_l) < 14)
    if fix.any():
        rgb[fix] = (up_rgb[fix] + dn_rgb[fix]) * 0.5
        arr[..., :3] = np.clip(rgb, 0, 255).astype(np.uint8)

    # light median as finishing pass
    rgb_im = Image.fromarray(arr[..., :3]).filter(ImageFilter.MedianFilter(size=3))
    rgb2 = np.asarray(rgb_im)
    opaque = arr[..., 3] >= 128
    arr[opaque, :3] = rgb2[opaque]
    return Image.fromarray(arr)


def fit_aligned(
    im: Image.Image,
    size: int = SIZE,
    pad_ratio: float = 0.08,
    center_xy: tuple[float, float] | None = None,
) -> tuple[Image.Image, tuple[float, float]]:
    """Fit sprite onto square canvas; optionally lock to a shared content center."""
    im = clean_sprite(im.convert("RGBA"))
    arr = np.asarray(im)
    x0, y0, x1, y1 = _bbox(arr)
    crop = im.crop((x0, y0, x1, y1))
    cw, ch = crop.size
    target = int(size * (1 - pad_ratio * 2))
    scale = min(target / max(1, cw), target / max(1, ch))
    nw, nh = max(1, int(cw * scale)), max(1, int(ch * scale))
    crop = crop.resize((nw, nh), Image.Resampling.LANCZOS)
    # content center in cropped scaled space
    local_cx, local_cy = nw / 2.0, nh / 2.0
    if center_xy is None:
        # place slightly above geometric center (pet sits in lower half)
        dest_cx, dest_cy = size / 2.0, size * 0.52
        center_xy = (dest_cx, dest_cy)
    else:
        dest_cx, dest_cy = center_xy
    px = int(round(dest_cx - local_cx))
    py = int(round(dest_cy - local_cy))
    canvas = Image.new("RGBA", (size, size), TRANSPARENT)
    canvas.paste(crop, (px, py), crop)
    return harden_alpha(canvas), center_xy


def load_anim_keys(style_key: str, state: str) -> list[Image.Image] | None:
    """Hard-cut flipbook from anim/00..0N (FRAMES 3..8).

    Frame layout: 00=poseA, 01..N-2=pose/prop beats, last=blink/closed accent.
    """
    anim_dir = WORK / style_key / "anim" / state
    paths = sorted(anim_dir.glob("*.png"))
    if len(paths) < 2:
        return None

    prepared: list[Image.Image] = []
    center: tuple[float, float] | None = None
    for p in paths:
        cut = clean_sprite(matte(Image.open(p)))
        framed, center = fit_aligned(cut, SIZE, center_xy=center)
        prepared.append(framed)

    n = len(prepared)
    # Legacy 2-frame: A↔B
    if n == 2:
        return [prepared[0], prepared[1], prepared[0], prepared[1]]

    open_ = prepared[0]
    blink = prepared[-1]
    acts = prepared[1:-1] if n >= 3 else []
    if not acts:
        acts = [prepared[1]]

    # Cycle pose beats, return to open, then blink — scales to FRAMES=3..8
    seq: list[Image.Image] = [open_]
    for act in acts:
        seq.append(act)
        seq.append(open_)
    if state == "sleeping":
        # prefer closed/act loop, skip sharp open blink
        return [open_, *acts, open_, acts[0]]
    seq.append(blink)
    if state == "talking" and acts:
        seq.append(acts[0])
    return seq


def build_keys_fallback(base: Image.Image, state: str) -> list[Image.Image]:
    """Last resort if anim beats missing: bob only (face untouched)."""
    open_ = harden_alpha(base)
    arr = np.asarray(open_)
    h, w = arr.shape[:2]

    def bob(dy: int) -> Image.Image:
        out = np.zeros_like(arr)
        if dy < 0:
            out[: h + dy] = arr[-dy:]
        elif dy > 0:
            out[dy:] = arr[: h - dy]
        else:
            out = arr.copy()
        return harden_alpha(Image.fromarray(out))

    return [open_, bob(-3), open_, bob(2)]


def save_gif_hardcut(frames: list[Image.Image], path: Path, durations: list[int]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    converted: list[Image.Image] = []
    for fr in frames:
        fr = harden_alpha(fr)
        arr = np.asarray(fr)
        opaque = arr[..., 3] >= 128
        rgb = arr[..., :3].copy()
        rgb[~opaque] = (0, 0, 0)
        base = Image.fromarray(rgb)
        # FASTOCTREE tends to band less on soft gradients than MEDIANCUT here
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

    converted[0].save(
        path,
        save_all=True,
        append_images=converted[1:],
        duration=durations,
        loop=0,
        disposal=2,
        transparency=0,
        optimize=False,
    )


def animate_state(style_key: str, state: str, dest: Path) -> None:
    keys = load_anim_keys(style_key, state)
    source = "anim"
    if keys is None:
        raw = WORK / style_key / "raw" / f"{state}.png"
        if not raw.exists():
            cands = sorted((WORK / style_key / "raw").glob(f"{state}*.png"))
            if not cands:
                print(f"WARN missing {style_key}/{state}")
                return
            raw = cands[0]
        cut = clean_sprite(matte(Image.open(raw)))
        base, _ = fit_aligned(cut, SIZE)
        keys = build_keys_fallback(base, state)
        source = "fallback-bob"

    frames_dir = dest.parent / "_frames"
    frames_dir.mkdir(exist_ok=True)
    for i, k in enumerate(keys):
        k.save(frames_dir / f"{state}_k{i}.png")

    # play forward then ease back (skip duplicating endpoints)
    order = list(range(len(keys))) + list(range(len(keys) - 2, 0, -1))
    frames = [keys[i] for i in order]
    durations = [frame_duration_ms(state, keys, i) for i in order]
    save_gif_hardcut(frames, dest, durations)
    print(
        f"wrote {dest} ({dest.stat().st_size // 1024}KB, {len(frames)}f, "
        f"cycle={sum(durations)}ms, via={source})"
    )


def _eye_dark_mass(frame: Image.Image) -> int:
    arr = np.asarray(frame.convert("RGBA"))
    x0, y0, x1, y1 = _bbox(arr)
    bw, bh = max(1, x1 - x0), max(1, y1 - y0)
    face = arr[y0 + int(bh * 0.18) : y0 + int(bh * 0.48), x0 + int(bw * 0.2) : x0 + int(bw * 0.8)]
    if face.size == 0:
        return 0
    rgb = face[..., :3].astype(np.float32)
    a = face[..., 3]
    lum = 0.299 * rgb[..., 0] + 0.587 * rgb[..., 1] + 0.114 * rgb[..., 2]
    # big shiny pupils are large dark blobs; closed crescents are thin
    return int(((a > 200) & (lum < 85)).sum())


def frame_duration_ms(state: str, keys: list[Image.Image], key_index: int) -> int:
    """Long open holds, short blinks, medium action poses — pet cadence."""
    open_m = max(1, _eye_dark_mass(keys[0]))
    this_m = _eye_dark_mass(keys[key_index])
    closed = this_m < open_m * 0.55
    if state == "sleeping":
        return 1100 if closed else 500
    if closed:
        return 150
    if key_index == 0:
        return 1100
    if state in ("talking", "done", "petted", "tool", "dragged"):
        return 450
    return 400


def write_readme(pack_dir: Path, skin_id: str, pack_name: str, files: list[str]) -> None:
    lines = [
        f"# {pack_name}（{skin_id}）",
        "",
        "CPET 图片皮肤包。生成见 `.cursor/skills/cpet-cute-skins/SKILL.md`。",
        "",
        "## 管线",
        f"- brief：`assets/skins/_work/{skin_id}/skin.json`",
        "- 动效：`animate-cute-skins.py` 硬切 GIF；贴边：`make-docked-from-idle.py`",
        "",
        "## 文件",
    ]
    for f in files:
        lines.append(f"- `{f}`")
    lines.append("")
    (pack_dir / "README.md").write_text("\n".join(lines), encoding="utf-8")


def process_skin(skin_id: str) -> None:
    work_id, pack_name = resolve_skin(skin_id)
    pack = OUT / pack_name
    pack.mkdir(parents=True, exist_ok=True)
    files = []
    for state in STATES:
        dest = pack / f"{state}.gif"
        animate_state(work_id, state, dest)
        if dest.exists():
            files.append(f"{state}.gif")
    write_readme(pack, work_id, pack_name, files)


def main() -> None:
    only = sys.argv[1] if len(sys.argv) > 1 else None
    keys = [only] if only else list_skins()
    print("matte: trying rembg, else edge-flood")
    print("stems:", len(STATES), "(lifecycle + actions)")
    for k in keys:
        process_skin(k)
    print("done")


if __name__ == "__main__":
    main()
