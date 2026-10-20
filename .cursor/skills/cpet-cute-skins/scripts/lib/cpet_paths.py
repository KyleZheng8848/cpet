"""Path + env resolution for the CPET skin factory (portable / cwd-independent).

Python mirror of ``lib/paths.mjs`` — keep the two in sync.

Output dir resolution (the only cwd-relative thing here, on purpose):

  1. $CPET_OUT_DIR (aliases: $CPET_SKINS_DIR, $CPET_ASSETS_DIR, $CPET_WORK_ROOT)
  2. existing ``cpet-skins/`` at cwd or any ancestor up to the project root
  3. existing CPET-shaped ``assets/skins/`` in that same range
     (already holds ``_work/`` or ``LIFECYCLE.json``)
  4. ``<cwd>/cpet-skins``

The upward walk stops at the project root (nearest ancestor with ``.git``) so a
stray ``~/cpet-skins`` can never swallow another project's output.

Catalogs resolve to the out dir when present, else to the skill's ``catalogs/``.

Importing this module also verifies Pillow + numpy are installed and exits with
an install hint instead of letting an ImportError traceback escape.
"""

from __future__ import annotations

import importlib.util
import os
import sys
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parents[1]
SKILL_ROOT = SCRIPTS.parent
SKILL_CATALOGS = SKILL_ROOT / "catalogs"

OUT_DIR_ENV = ("CPET_OUT_DIR", "CPET_SKINS_DIR", "CPET_ASSETS_DIR", "CPET_WORK_ROOT")
DEFAULT_OUT_NAME = "cpet-skins"

_REQUIRED_MODULES = {"PIL": "Pillow", "numpy": "numpy"}


def _require_imaging() -> None:
    missing = [pkg for mod, pkg in _REQUIRED_MODULES.items() if importlib.util.find_spec(mod) is None]
    if not missing:
        return
    raise SystemExit(
        "CPET skin factory needs Python packages: "
        + ", ".join(missing)
        + "\n  python3 -m pip install --user "
        + " ".join(missing)
        + "\n  (or run inside a venv: python3 -m venv .venv && . .venv/bin/activate && pip install "
        + " ".join(missing)
        + ")"
    )


_require_imaging()


def _looks_like_skins_dir(p: Path) -> bool:
    return (p / "_work").is_dir() or (p / "LIFECYCLE.json").exists()


def _search_dirs() -> list[Path]:
    """cwd, then each ancestor up to and including the project root (.git holder)."""
    cur = Path.cwd().resolve()
    chain: list[Path] = []
    for d in (cur, *cur.parents):
        chain.append(d)
        if (d / ".git").exists():
            return chain
    return [cur]


def _find_in_project(rel: str, accept=None) -> Path | None:
    accept = accept or (lambda p: True)
    for d in _search_dirs():
        hit = d / rel
        if hit.is_dir() and accept(hit):
            return hit
    return None


def _parse_env_file(text: str) -> dict[str, str]:
    out: dict[str, str] = {}
    for raw in text.splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        body = line[7:].strip() if line.startswith("export ") else line
        if "=" not in body:
            continue
        key, _, value = body.partition("=")
        key = key.strip()
        if not key or not (key[0].isalpha() or key[0] == "_"):
            continue
        value = value.strip()
        if len(value) > 1 and value[0] == value[-1] and value[0] in "\"'":
            value = value[1:-1]
        out[key] = value
    return out


def env_file_candidates() -> list[Path]:
    files: list[Path] = []
    for key in ("CPET_ENV_FILE", "CPET_SKINS_ENV"):
        v = os.environ.get(key, "").strip()
        if v:
            files.append(Path(v).expanduser().resolve())
    for d in _search_dirs():
        files.append(d / ".env.local")
        files.append(d / ".env")
    files.append(Path.home() / ".config/cpet-skins/.env")
    return files


def load_env_files() -> list[Path]:
    """Fill in missing env vars from .env files. Never overrides the real env."""
    used: list[Path] = []
    for f in env_file_candidates():
        if not f.exists():
            continue
        try:
            parsed = _parse_env_file(f.read_text(encoding="utf-8"))
        except OSError:
            continue
        applied = False
        for k, v in parsed.items():
            if k not in os.environ:
                os.environ[k] = v
                applied = True
        if applied:
            used.append(f)
    return used


ENV_FILES_LOADED = load_env_files()


def _resolve_out() -> tuple[Path, str]:
    for key in OUT_DIR_ENV:
        v = os.environ.get(key, "").strip()
        if v:
            return Path(v).expanduser().resolve(), f"${key}"
    own = _find_in_project(DEFAULT_OUT_NAME)
    if own:
        return own, f"{DEFAULT_OUT_NAME}/ found in project"
    legacy = _find_in_project("assets/skins", _looks_like_skins_dir)
    if legacy:
        return legacy, "CPET-shaped assets/skins found in project"
    return Path.cwd().resolve() / DEFAULT_OUT_NAME, f"<cwd>/{DEFAULT_OUT_NAME} (default)"


SKINS, SKINS_SOURCE = _resolve_out()
WORK = SKINS / "_work"


def work_dir(skin_id: str) -> Path:
    return WORK / skin_id


def pack_dir(pack_name: str) -> Path:
    return SKINS / pack_name


def catalog_path(name: str) -> Path:
    override = os.environ.get("CPET_CATALOG_DIR", "").strip()
    if override:
        p = Path(override).expanduser().resolve() / name
        if p.exists():
            return p
    primary = SKINS / name
    if primary.exists():
        return primary
    bundled = SKILL_CATALOGS / name
    if bundled.exists():
        return bundled
    raise SystemExit(
        f"missing catalog {name}\n  looked in: {primary}\n             {bundled}\n"
        f"  (out dir from {SKINS_SOURCE}; set CPET_OUT_DIR to override)"
    )


def describe_paths() -> str:
    env = ", ".join(str(f) for f in ENV_FILES_LOADED) or "(none found)"
    return "\n".join(
        [
            f"skill      {SKILL_ROOT}",
            f"out dir    {SKINS}   [{SKINS_SOURCE}]" + ("" if SKINS.exists() else "   (does not exist yet)"),
            f"work       {WORK}" + ("" if WORK.exists() else "   (does not exist yet)"),
            f"catalogs   {SKINS if (SKINS / 'LIFECYCLE.json').exists() else SKILL_CATALOGS}",
            f"env files  {env}",
        ]
    )


def die_missing(what: str) -> "SystemExit":
    """Build a SystemExit that always shows how paths were resolved."""
    return SystemExit(f"{what}\n{describe_paths()}\n  set CPET_OUT_DIR to point at another skins dir.")
