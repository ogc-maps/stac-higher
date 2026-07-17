# Phase 4 · Slice B4 — EXTRACT + ITEMIZE Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the ingest chain past `stored` — EXTRACT builds a STAC item from a group's canonical assets, ITEMIZE validates and upserts it into pgstac, post-ingest cleans the source — so a dropped source file becomes a queryable STAC item within one poll cycle, idempotently, and a changed file updates the same item.

**Architecture:** One new queue stage, `pipeline.ingest_itemize`, that FETCH enqueues per ready group. A pure `extract.py` builds an item dict from the group's stored members (reading bytes back from canonical storage; `rasterio.MemoryFile` for rasters, stdlib parsers for sidecars, a hand-built null-geometry dict for defaults). A `run_itemize` orchestrator validates via stac-pydantic, upserts via a `PgstacWriter` seam (pypgstac behind an ABC), advances the ledger `stored → itemized`, then applies the `post_ingest` source action. Everything is unit-testable against the existing `IngestRepo` fake plus a fake writer/adapter/S3 client; a DB integration test and a live e2e close the loop.

**Tech Stack:** Python 3.12, rio-stac + rasterio (bundled-GDAL wheels), pystac, stac-pydantic (validation), pypgstac (upsert), defusedxml (safe sidecar XML parsing), psycopg 3, Procrastinate, boto3, pytest + ruff, uv.

## Global Constraints

- **Base branch is `ai/main`.** Work in a worktree: `git worktree add .claude/worktrees/phase4-b4 -b ai/phase4-b4 ai/main`. Run `npm install` at repo root once (wires workspaces) and `uv sync --extra dev` in `services/pipeline/` before verifying.
- **Pipeline verify:** `uv run pytest` and `uv run ruff check` in `services/pipeline/` must both pass before any task is "done". App `npm run verify` must remain green (this slice touches `docker-compose.yml`, not app code, but run it once before merge).
- **ADR 0001 (migration ownership):** the pipeline NEVER runs DDL. pypgstac `Methods.upsert` writes item **data** only (verified: it creates only `ON COMMIT DROP` temp tables + calls pgstac's own `upsert_item`). Do not call any pypgstac `migrate` path.
- **Dependency pins (verified on PyPI 2026-07, Python 3.12-clean, no conflict with `psycopg 3.3.4` / `procrastinate 3.9.0`):** `rio-stac==0.12.0`, `pystac==1.15.1`, `rasterio>=1.5,<2`, `stac-pydantic==3.6.0`, `pypgstac[psycopg]==0.9.11`, `defusedxml>=0.7.1`. No `pyproj` (rasterio bundles PROJ). No new app dependencies.
- **XML parsing MUST use `defusedxml`, never stdlib `xml.etree`** — stdlib blocks external-entity XXE but is still vulnerable to entity-expansion DoS (billion-laughs / quadratic-blowup); the FISMA-High posture requires the hardened parser.
- **No system GDAL / no Dockerfile change:** rasterio 1.5 manylinux + macOS-arm64 wheels are self-contained. Add `[tool.uv] no-build-package = ["rasterio"]` so a source build can never be triggered.
- **pgstac lockstep:** pin the compose pgstac image to a `v0.9.x` tag matching pypgstac 0.9.11 (off `:latest`).
- **Asset hrefs mirror the app exactly** (`app/src/lib/storage/keys.ts::assetHref`): root-relative, URL-encoded-per-segment `/api/assets/{collection}/{item_id}/{filename}`.
- **Datetimes are tz-aware UTC** (RFC3339 `...Z`); never emit a naive datetime.
- **Blocking calls off the event loop:** pypgstac and boto3 are synchronous — always wrap in `asyncio.to_thread`.
- **Ledger statuses** (mirror migration 005): `seen|settled|fetching|stored|itemized|failed`. B4 advances `stored → itemized` (or `→ failed`).
- Reference-mode (`storage_mode: reference`) associations never reach ITEMIZE — the earlier stages already stop them. No reference handling in this slice.

---

## File Structure

**Create:**
- `services/pipeline/src/pipeline/ingest/extract.py` — build a STAC item dict from a group's stored members (3 strategies). Pure.
- `services/pipeline/src/pipeline/ingest/itemize.py` — `run_itemize` orchestrator + validation gate + ledger transitions.
- `services/pipeline/src/pipeline/ingest/postingest.py` — `apply_post_ingest` (leave/delete/move).
- `services/pipeline/src/pipeline/stac/__init__.py`, `services/pipeline/src/pipeline/stac/pgstac_writer.py` — `PgstacWriter` ABC + `PgPgstacWriter` (pypgstac) + module for the fake to import.
- Tests: `tests/test_ingest_extract.py`, `tests/test_ingest_itemize.py`, `tests/test_ingest_postingest.py`, `tests/test_pgstac_writer.py`.
- `docs/decisions/0006-ingest-metadata-and-upsert.md`.

**Modify:**
- `services/pipeline/pyproject.toml` — deps + `[tool.uv] no-build-package`.
- `services/pipeline/uv.lock` — via `uv lock`.
- `docker-compose.yml` — pin pgstac image tag.
- `services/pipeline/src/pipeline/config.py` — add `asset_href_base` setting.
- `services/pipeline/src/pipeline/storage/keys.py` — add `asset_href(...)`.
- `services/pipeline/src/pipeline/storage/platform.py` — add `get_object(...)` + extend `S3Like`.
- `services/pipeline/src/pipeline/jobs/ingest.py` — register + wire `pipeline.ingest_itemize`; FETCH enqueues it.
- `tests/test_ingest_jobs.py` / `tests/test_main_jobs.py` — wiring assertions.
- `ROADMAP.md`, `docs/FEATURES.md`, `docs/ISSUES.md`, `services/pipeline/README.md` — status + limitations.

---

## Task 1: Dependencies, uv wheel guardrail, pgstac image pin

**Files:**
- Modify: `services/pipeline/pyproject.toml`
- Modify: `services/pipeline/uv.lock` (generated)
- Modify: `docker-compose.yml`

**Interfaces:**
- Produces: importable `rio_stac`, `pystac`, `rasterio`, `stac_pydantic`, `pypgstac` in the pipeline venv.

- [ ] **Step 1: Add dependencies to `pyproject.toml`**

In `[project].dependencies`, append:

```toml
    "rio-stac==0.12.0",
    "pystac==1.15.1",
    "rasterio>=1.5,<2",
    "stac-pydantic==3.6.0",
    "pypgstac[psycopg]==0.9.11",
    "defusedxml>=0.7.1",
```

After the `[tool.ruff]` block (top-level), add:

```toml
[tool.uv]
no-build-package = ["rasterio"]
```

- [ ] **Step 2: Lock and install**

Run (in `services/pipeline/`): `uv lock && uv sync --extra dev`
Expected: resolves and installs; `uv.lock` updated. If `uv` attempts a source build of rasterio, the guardrail/error means a wheel wasn't found — stop and investigate (do not add system GDAL).

- [ ] **Step 3: Verify imports and GDAL wheel**

Run: `uv run python -c "import rasterio, rio_stac, pystac, stac_pydantic, pypgstac; from osgeo import gdal_version if False else None; print(rasterio.__gdal_version__)"`
(Simpler:) Run: `uv run python -c "import rasterio, rio_stac, pystac, stac_pydantic; import pypgstac.load; print('gdal', rasterio.__gdal_version__)"`
Expected: prints a GDAL version (e.g. `gdal 3.12.1`), no ImportError.

- [ ] **Step 4: Pin the pgstac image**

In `docker-compose.yml`, find the pgstac service image `ghcr.io/stac-utils/pgstac:latest` and change the tag to the current 0.9.x release matching pypgstac 0.9.11. Determine the exact tag:

Run: `uv run python -c "import pypgstac; print(pypgstac.__version__)"` → confirms `0.9.11`; pin the image to `ghcr.io/stac-utils/pgstac:v0.9.11` (pgstac ships the image and the pypgstac client from the same tag).

- [ ] **Step 5: Sanity-check ruff and existing tests still pass**

Run: `uv run ruff check && uv run pytest -q`
Expected: ruff clean; all existing tests pass (new deps don't break anything).

- [ ] **Step 6: Commit**

```bash
git add services/pipeline/pyproject.toml services/pipeline/uv.lock docker-compose.yml
git commit -m "build(pipeline): add rio-stac/pystac/stac-pydantic/pypgstac + pin pgstac v0.9.11"
```

---

## Task 2: Shared primitives — `asset_href`, `platform.get_object`, `asset_href_base` setting

**Files:**
- Modify: `services/pipeline/src/pipeline/storage/keys.py`
- Modify: `services/pipeline/src/pipeline/storage/platform.py`
- Modify: `services/pipeline/src/pipeline/config.py`
- Test: `tests/test_storage_keys.py` (extend), `tests/test_config.py` (extend)

**Interfaces:**
- Produces:
  - `storage.keys.asset_href(collection: str, item_id: str, filename: str, *, base: str = "/api/assets") -> str` — root-relative, URL-encoded per segment.
  - `storage.platform.get_object(client: S3Like, bucket: str, key: str) -> bytes` (sync; wrap in `asyncio.to_thread`).
  - `S3Like.get_object(**kwargs) -> Any` added to the Protocol.
  - `Settings.asset_href_base: str` (default `/api/assets`), from env `ASSET_HREF_BASE`.

- [ ] **Step 1: Write failing test for `asset_href`**

In `tests/test_storage_keys.py`:

```python
from pipeline.storage.keys import asset_href


def test_asset_href_is_root_relative_and_encoded():
    assert (
        asset_href("col lection", "item/id", "a b.tif")
        == "/api/assets/col%20lection/item%2Fid/a%20b.tif"
    )


def test_asset_href_respects_custom_base():
    assert asset_href("c", "i", "f.tif", base="/assets") == "/assets/c/i/f.tif"
```

- [ ] **Step 2: Run to verify it fails**

Run: `uv run pytest tests/test_storage_keys.py::test_asset_href_is_root_relative_and_encoded -v`
Expected: FAIL (ImportError: cannot import name `asset_href`).

- [ ] **Step 3: Implement `asset_href`**

In `storage/keys.py` add (mirrors `app/src/lib/storage/keys.ts::assetHref`):

```python
from urllib.parse import quote


def asset_href(
    collection: str, item_id: str, filename: str, *, base: str = "/api/assets"
) -> str:
    """Root-relative `/api/assets/{collection}/{item_id}/{filename}` href, each
    segment URL-encoded. Mirrors the app's `assetHref` so pipeline-created items
    resolve through the same asset route as manually uploaded ones."""
    seg = lambda s: quote(s, safe="")  # noqa: E731
    return f"{base.rstrip('/')}/{seg(collection)}/{seg(item_id)}/{seg(filename)}"
```

- [ ] **Step 4: Run to verify it passes**

Run: `uv run pytest tests/test_storage_keys.py -v`
Expected: PASS.

- [ ] **Step 5: Write failing test for `platform.get_object`**

In `tests/test_staging_cleanup.py` is platform-focused; add a new focused test file `tests/test_platform_get.py`:

```python
import io

from pipeline.storage.platform import get_object


class _FakeS3:
    def __init__(self, objects):
        self.objects = objects

    def get_object(self, Bucket, Key):  # noqa: N803 (boto3 kwarg names)
        return {"Body": io.BytesIO(self.objects[(Bucket, Key)])}


def test_get_object_reads_body_bytes():
    client = _FakeS3({("bucket", "assets/c/i/f.tif"): b"RAWBYTES"})
    assert get_object(client, "bucket", "assets/c/i/f.tif") == b"RAWBYTES"
```

- [ ] **Step 6: Run to verify it fails**

Run: `uv run pytest tests/test_platform_get.py -v`
Expected: FAIL (ImportError: cannot import name `get_object`).

- [ ] **Step 7: Implement `get_object` + extend `S3Like`**

In `storage/platform.py`, add `get_object` to the `S3Like` Protocol:

```python
    def get_object(self, **kwargs: Any) -> Any: ...
```

And add the helper next to `put_object`:

```python
def get_object(client: S3Like, bucket: str, key: str) -> bytes:
    """Read the object at ``key`` back as bytes (ingest EXTRACT reads what FETCH
    stored). Pure over an injected client; synchronous boto3 — wrap in
    ``asyncio.to_thread`` on the event loop. Fully buffered (ISSUES I-19)."""
    resp = client.get_object(Bucket=bucket, Key=key)
    return resp["Body"].read()
```

- [ ] **Step 8: Run to verify it passes**

Run: `uv run pytest tests/test_platform_get.py -v`
Expected: PASS.

- [ ] **Step 9: Add `asset_href_base` setting + failing test**

In `tests/test_config.py`, add:

```python
def test_asset_href_base_defaults_and_env(monkeypatch):
    from pipeline.config import Settings

    assert Settings.from_env({}).asset_href_base == "/api/assets"
    assert Settings.from_env({"ASSET_HREF_BASE": "/assets"}).asset_href_base == "/assets"
```

- [ ] **Step 10: Implement the setting**

In `config.py`: add a default constant near the others:

```python
DEFAULT_ASSET_HREF_BASE = "/api/assets"
```

Add the field to the `Settings` dataclass (with the other fields):

```python
    asset_href_base: str = DEFAULT_ASSET_HREF_BASE
```

And in `from_env(...)`, add:

```python
            asset_href_base=env.get("ASSET_HREF_BASE", DEFAULT_ASSET_HREF_BASE),
```

Also add an `ASSET_HREF_BASE` line to the env-contract docstring at the top of `config.py`.

- [ ] **Step 11: Run all changed tests + ruff**

Run: `uv run pytest tests/test_storage_keys.py tests/test_platform_get.py tests/test_config.py -v && uv run ruff check`
Expected: PASS, ruff clean.

- [ ] **Step 12: Commit**

```bash
git add services/pipeline/src/pipeline/storage/keys.py services/pipeline/src/pipeline/storage/platform.py services/pipeline/src/pipeline/config.py services/pipeline/tests/test_storage_keys.py services/pipeline/tests/test_platform_get.py services/pipeline/tests/test_config.py
git commit -m "feat(pipeline): asset_href builder, platform.get_object, ASSET_HREF_BASE setting"
```

---

## Task 3: EXTRACT — metadata parse, datetime resolution, media map, `defaults_only`

**Files:**
- Create: `services/pipeline/src/pipeline/ingest/extract.py`
- Test: `tests/test_ingest_extract.py`

**Interfaces:**
- Produces (consumed by Tasks 4, 5, 8):
  - `ExtractError(ValueError)`.
  - `@dataclass(frozen=True) ExtractMember: source_path: str; filename: str; canonical_key: str; observed_at: datetime | None`.
  - `@dataclass(frozen=True) MetadataConfig: strategy: str; sidecar_pattern: str | None; sidecar_parser: str; default_datetime: str | None`.
  - `parse_metadata(raw: dict[str, Any]) -> MetadataConfig`.
  - `MEDIA_TYPES: dict[str, str]` and `media_type_for(filename: str) -> str`.
  - `resolve_datetime(extracted: datetime | None, cfg: MetadataConfig, primary: ExtractMember) -> datetime` (raises `ExtractError` if unresolvable).
  - `build_assets(members, collection_id, item_id, asset_href_base, primary_filename) -> dict[str, dict]`.
  - `build_defaults_only(collection_id, item_id, members, cfg, asset_href_base) -> dict` — a full STAC item dict, `geometry: null`, no `bbox`.

- [ ] **Step 1: Write failing tests (parse, datetime, media, defaults_only)**

In `tests/test_ingest_extract.py`:

```python
import datetime as dt

import pytest

from pipeline.ingest.extract import (
    ExtractError,
    ExtractMember,
    build_defaults_only,
    media_type_for,
    parse_metadata,
    resolve_datetime,
)


def _member(name="scene.tif", observed=None):
    return ExtractMember(
        source_path=f"products/{name}",
        filename=name,
        canonical_key=f"assets/col/scene/{name}",
        observed_at=observed,
    )


def test_parse_metadata_defaults():
    cfg = parse_metadata({})
    assert cfg.strategy == "raster_auto"
    assert cfg.sidecar_parser == "generic_xml"
    assert cfg.default_datetime is None


def test_parse_metadata_sidecar_and_defaults():
    cfg = parse_metadata(
        {
            "strategy": "sidecar",
            "sidecar": {"pattern": "{basename}.xml", "parser": "json"},
            "defaults": {"datetime": "file_mtime"},
        }
    )
    assert cfg.strategy == "sidecar"
    assert cfg.sidecar_pattern == "{basename}.xml"
    assert cfg.sidecar_parser == "json"
    assert cfg.default_datetime == "file_mtime"


def test_media_type_for_known_and_unknown():
    assert media_type_for("a.tif") == "image/tiff; application=geotiff"
    assert media_type_for("a.TIFF") == "image/tiff; application=geotiff"
    assert media_type_for("a.bin") == "application/octet-stream"


def test_resolve_datetime_prefers_extracted():
    cfg = parse_metadata({})
    got = resolve_datetime(dt.datetime(2020, 1, 1, tzinfo=dt.UTC), cfg, _member())
    assert got == dt.datetime(2020, 1, 1, tzinfo=dt.UTC)


def test_resolve_datetime_literal_default():
    cfg = parse_metadata({"defaults": {"datetime": "2021-06-01T00:00:00Z"}})
    got = resolve_datetime(None, cfg, _member())
    assert got == dt.datetime(2021, 6, 1, tzinfo=dt.UTC)


def test_resolve_datetime_file_mtime_uses_observed():
    cfg = parse_metadata({"defaults": {"datetime": "file_mtime"}})
    observed = dt.datetime(2022, 3, 3, tzinfo=dt.UTC)
    got = resolve_datetime(None, cfg, _member(observed=observed))
    assert got == observed


def test_resolve_datetime_unresolvable_raises():
    cfg = parse_metadata({})
    with pytest.raises(ExtractError):
        resolve_datetime(None, cfg, _member(observed=None))


def test_build_defaults_only_null_geometry_item():
    cfg = parse_metadata(
        {"strategy": "defaults_only", "defaults": {"datetime": "2021-06-01T00:00:00Z"}}
    )
    item = build_defaults_only("col", "scene", [_member()], cfg, "/api/assets")
    assert item["id"] == "scene"
    assert item["collection"] == "col"
    assert item["geometry"] is None
    assert "bbox" not in item
    assert item["properties"]["datetime"] == "2021-06-01T00:00:00Z"
    assert item["assets"]["scene"]["href"] == "/api/assets/col/scene/scene.tif"
    assert item["assets"]["scene"]["type"] == "image/tiff; application=geotiff"
```

- [ ] **Step 2: Run to verify they fail**

Run: `uv run pytest tests/test_ingest_extract.py -v`
Expected: FAIL (module `pipeline.ingest.extract` does not exist).

- [ ] **Step 3: Implement the pure helpers in `extract.py`**

```python
"""EXTRACT stage: build a STAC item dict from a group's stored members (§6.1).

Three metadata strategies (§5.1): `raster_auto` (rio-stac over the primary
raster), `sidecar` (parse an adjacent XML/JSON file), `defaults_only` (no
extraction — a null-geometry item from collection defaults). The bytes are read
back from canonical storage (FETCH already put them there), so raster reads go
through an in-memory `rasterio.MemoryFile` — no GDAL S3 config needed. Output is
a plain STAC item dict ready for the ITEMIZE validation gate; a field that can't
be resolved raises `ExtractError` (→ group marked failed) rather than emitting a
bad item.
"""

from __future__ import annotations

import datetime as dt
import posixpath
from dataclasses import dataclass
from typing import Any

from pipeline.storage.keys import asset_href

STAC_VERSION = "1.0.0"

MEDIA_TYPES: dict[str, str] = {
    ".tif": "image/tiff; application=geotiff",
    ".tiff": "image/tiff; application=geotiff",
    ".jp2": "image/jp2",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".json": "application/json",
    ".geojson": "application/geo+json",
    ".xml": "application/xml",
}
RASTER_EXTS = frozenset({".tif", ".tiff", ".jp2", ".png", ".jpg", ".jpeg"})


class ExtractError(ValueError):
    """A group cannot be turned into a valid STAC item (missing required field,
    unreadable raster, unparseable sidecar)."""


@dataclass(frozen=True)
class ExtractMember:
    """One stored group member EXTRACT reads. ``canonical_key`` is the object
    key FETCH wrote; ``observed_at`` is the ledger's settle time (the
    ``file_mtime`` datetime proxy — no durable source mtime exists)."""

    source_path: str
    filename: str
    canonical_key: str
    observed_at: dt.datetime | None


@dataclass(frozen=True)
class MetadataConfig:
    strategy: str
    sidecar_pattern: str | None
    sidecar_parser: str
    default_datetime: str | None


def parse_metadata(raw: dict[str, Any]) -> MetadataConfig:
    """Typed view over the association config's ``metadata`` block (§5.1)."""
    sidecar = raw.get("sidecar") or {}
    defaults = raw.get("defaults") or {}
    strategy = str(raw.get("strategy", "raster_auto"))
    if strategy not in ("raster_auto", "sidecar", "defaults_only"):
        raise ExtractError(f"unknown metadata.strategy {strategy!r}")
    return MetadataConfig(
        strategy=strategy,
        sidecar_pattern=sidecar.get("pattern"),
        sidecar_parser=str(sidecar.get("parser", "generic_xml")),
        default_datetime=defaults.get("datetime"),
    )


def media_type_for(filename: str) -> str:
    ext = posixpath.splitext(filename)[1].lower()
    return MEDIA_TYPES.get(ext, "application/octet-stream")


def is_raster(filename: str) -> bool:
    return posixpath.splitext(filename)[1].lower() in RASTER_EXTS


def _parse_rfc3339(value: str) -> dt.datetime:
    parsed = dt.datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=dt.UTC)
    return parsed


def resolve_datetime(
    extracted: dt.datetime | None, cfg: MetadataConfig, primary: ExtractMember
) -> dt.datetime:
    """extracted → metadata.defaults.datetime → error. `file_mtime` uses the
    member's ledger settle time (documented approximation)."""
    if extracted is not None:
        return extracted if extracted.tzinfo else extracted.replace(tzinfo=dt.UTC)
    default = cfg.default_datetime
    if default == "file_mtime":
        if primary.observed_at is not None:
            return primary.observed_at
        raise ExtractError("file_mtime requested but no observed time on the ledger row")
    if default:
        return _parse_rfc3339(default)
    raise ExtractError("no datetime could be resolved (no extraction, no default)")


def _rfc3339(value: dt.datetime) -> str:
    return value.astimezone(dt.UTC).isoformat().replace("+00:00", "Z")


def build_assets(
    members: list[ExtractMember],
    collection_id: str,
    item_id: str,
    asset_href_base: str,
    primary_filename: str,
) -> dict[str, dict[str, Any]]:
    """One asset per member, keyed by filename stem; primary gets role `data`,
    others `metadata`. Hrefs point at the app asset route."""
    assets: dict[str, dict[str, Any]] = {}
    for m in members:
        key = posixpath.splitext(m.filename)[0]
        role = "data" if m.filename == primary_filename else "metadata"
        assets[key] = {
            "href": asset_href(collection_id, item_id, m.filename, base=asset_href_base),
            "type": media_type_for(m.filename),
            "roles": [role],
        }
    return assets


def _primary(members: list[ExtractMember]) -> ExtractMember:
    for m in members:
        if is_raster(m.filename):
            return m
    return members[0]


def build_defaults_only(
    collection_id: str,
    item_id: str,
    members: list[ExtractMember],
    cfg: MetadataConfig,
    asset_href_base: str,
) -> dict[str, Any]:
    """A null-geometry STAC item from collection defaults (no extraction)."""
    if not members:
        raise ExtractError("no members to itemize")
    primary = _primary(members)
    when = resolve_datetime(None, cfg, primary)
    return {
        "type": "Feature",
        "stac_version": STAC_VERSION,
        "stac_extensions": [],
        "id": item_id,
        "collection": collection_id,
        "geometry": None,
        "properties": {"datetime": _rfc3339(when)},
        "assets": build_assets(
            members, collection_id, item_id, asset_href_base, primary.filename
        ),
        "links": [],
    }
```

- [ ] **Step 4: Run to verify tests pass**

Run: `uv run pytest tests/test_ingest_extract.py -v && uv run ruff check`
Expected: PASS, ruff clean.

- [ ] **Step 5: Commit**

```bash
git add services/pipeline/src/pipeline/ingest/extract.py services/pipeline/tests/test_ingest_extract.py
git commit -m "feat(pipeline): EXTRACT primitives + defaults_only strategy"
```

---

## Task 4: EXTRACT — `sidecar` strategy (XML/JSON parsing)

**Files:**
- Modify: `services/pipeline/src/pipeline/ingest/extract.py`
- Test: `tests/test_ingest_extract.py` (extend)

**Interfaces:**
- Produces (consumed by Task 5's dispatch + Task 8):
  - `parse_sidecar(data: bytes, parser: str) -> dict[str, Any]` — returns `{"datetime": datetime|None, "geometry": dict|None, "properties": dict}`; raises `ExtractError` on unparseable input.
  - `build_sidecar(collection_id, item_id, members, cfg, sidecar_bytes, asset_href_base) -> dict` — item dict using sidecar values, null geometry if none.

- [ ] **Step 1: Write failing tests for sidecar parsing**

Append to `tests/test_ingest_extract.py`:

```python
from pipeline.ingest.extract import build_sidecar, parse_sidecar

_XML = b"""<?xml version="1.0"?>
<product><acquired>2023-05-05T10:00:00Z</acquired></product>"""

_XXE = b"""<?xml version="1.0"?>
<!DOCTYPE d [<!ENTITY x SYSTEM "file:///etc/passwd">]>
<product><acquired>2023-05-05T10:00:00Z</acquired>&x;</product>"""


def test_parse_sidecar_json_datetime():
    out = parse_sidecar(b'{"datetime": "2023-05-05T10:00:00Z"}', "json")
    assert out["datetime"] == dt.datetime(2023, 5, 5, 10, tzinfo=dt.UTC)


def test_parse_sidecar_generic_xml_datetime():
    out = parse_sidecar(_XML, "generic_xml")
    assert out["datetime"] == dt.datetime(2023, 5, 5, 10, tzinfo=dt.UTC)


def test_parse_sidecar_xml_is_xxe_safe():
    # defusedxml forbids DOCTYPE entities → parse is blocked, surfaced as
    # ExtractError. The local file is never read.
    with pytest.raises(ExtractError):
        parse_sidecar(_XXE, "generic_xml")


def test_build_sidecar_uses_extracted_datetime():
    members = [
        _member("scene.tif"),
        ExtractMember("products/scene.xml", "scene.xml", "assets/col/scene/scene.xml", None),
    ]
    cfg = parse_metadata({"strategy": "sidecar", "sidecar": {"pattern": "{basename}.xml"}})
    item = build_sidecar("col", "scene", members, cfg, _XML, "/api/assets")
    assert item["properties"]["datetime"] == "2023-05-05T10:00:00Z"
    assert set(item["assets"]) == {"scene"}  # both members, keyed by stem
    assert item["assets"]["scene"]["roles"] == ["data"]
```

- [ ] **Step 2: Run to verify they fail**

Run: `uv run pytest tests/test_ingest_extract.py -k sidecar -v`
Expected: FAIL (cannot import `parse_sidecar`).

- [ ] **Step 3: Implement sidecar parsing**

Add to `extract.py`:

```python
import json
# defusedxml hardens against XXE + entity-expansion DoS (billion-laughs /
# quadratic-blowup) that stdlib xml.etree does NOT defend against. Required by
# the FISMA-High posture — never swap this back to stdlib.
from defusedxml.ElementTree import fromstring as _xml_fromstring
from defusedxml.common import DefusedXmlException
from xml.etree.ElementTree import Element, ParseError  # types only


def _find_datetime_in_xml(root: Element) -> dt.datetime | None:
    # Look for a small set of common date-ish tags (namespace-agnostic: compare
    # local tag names). Minimal MVP field set — richer mapping is a follow-up.
    wanted = {"datetime", "acquired", "date", "acquisitiondate", "start_datetime"}
    for el in root.iter():
        local = el.tag.rsplit("}", 1)[-1].lower()
        if local in wanted and el.text and el.text.strip():
            try:
                return _parse_rfc3339(el.text.strip())
            except ValueError:
                continue
    return None


def parse_sidecar(data: bytes, parser: str) -> dict[str, Any]:
    """Extract a minimal field set from a sidecar. XXE-safe: the stdlib XML
    parser does not resolve external entities, and a DOCTYPE with entities is
    rejected."""
    if parser == "json":
        try:
            doc = json.loads(data)
        except (json.JSONDecodeError, ValueError) as exc:
            raise ExtractError(f"sidecar JSON parse failed: {exc}") from exc
        when = doc.get("datetime")
        return {
            "datetime": _parse_rfc3339(when) if isinstance(when, str) else None,
            "geometry": doc.get("geometry"),
            "properties": doc.get("properties") or {},
        }
    if parser == "generic_xml":
        try:
            root = _xml_fromstring(data)
        except (ParseError, DefusedXmlException) as exc:
            # DefusedXmlException = DOCTYPE/entity/external-ref blocked (XXE/DoS).
            raise ExtractError(f"sidecar XML parse failed/blocked: {exc}") from exc
        return {"datetime": _find_datetime_in_xml(root), "geometry": None, "properties": {}}
    raise ExtractError(f"unknown sidecar parser {parser!r}")


def build_sidecar(
    collection_id: str,
    item_id: str,
    members: list[ExtractMember],
    cfg: MetadataConfig,
    sidecar_bytes: bytes,
    asset_href_base: str,
) -> dict[str, Any]:
    if not members:
        raise ExtractError("no members to itemize")
    primary = _primary(members)
    parsed = parse_sidecar(sidecar_bytes, cfg.sidecar_parser)
    when = resolve_datetime(parsed["datetime"], cfg, primary)
    item: dict[str, Any] = {
        "type": "Feature",
        "stac_version": STAC_VERSION,
        "stac_extensions": [],
        "id": item_id,
        "collection": collection_id,
        "geometry": parsed["geometry"],
        "properties": {**parsed["properties"], "datetime": _rfc3339(when)},
        "assets": build_assets(
            members, collection_id, item_id, asset_href_base, primary.filename
        ),
        "links": [],
    }
    if parsed["geometry"] is None:
        item.pop("bbox", None)  # keep null geometry without a bbox
    return item
```

Note: `defusedxml.ElementTree.fromstring` rejects any DOCTYPE-declared entity (and external references) up front, raising a `DefusedXmlException`, so `_XXE` deterministically becomes an `ExtractError` and the referenced local file is never touched. It also defends against entity-expansion DoS (billion-laughs / quadratic-blowup) that stdlib `xml.etree` does not — this is why the plan mandates defusedxml.

- [ ] **Step 4: Run to verify tests pass**

Run: `uv run pytest tests/test_ingest_extract.py -k sidecar -v && uv run ruff check`
Expected: PASS, ruff clean.

- [ ] **Step 5: Commit**

```bash
git add services/pipeline/src/pipeline/ingest/extract.py services/pipeline/tests/test_ingest_extract.py
git commit -m "feat(pipeline): EXTRACT sidecar strategy (XXE-safe XML/JSON)"
```

---

## Task 5: EXTRACT — `raster_auto` + async `build_item` dispatch

**Files:**
- Modify: `services/pipeline/src/pipeline/ingest/extract.py`
- Test: `tests/test_ingest_extract.py` (extend)

**Interfaces:**
- Produces (consumed by Task 8):
  - `build_raster_auto(collection_id, item_id, members, cfg, raster_bytes, asset_href_base) -> dict` — uses rio-stac over a `MemoryFile`; overrides asset hrefs to the app route; `to_dict(include_self_link=False, transform_hrefs=False)`.
  - `async build_item(*, collection_id, item_id, members, metadata, s3_client, bucket, asset_href_base) -> dict` — reads bytes via `get_object` in a thread, dispatches on strategy, returns the item dict.

- [ ] **Step 1: Write failing tests for raster_auto + dispatch**

Append to `tests/test_ingest_extract.py`:

```python
import io

import numpy as np
import rasterio
from rasterio.io import MemoryFile
from rasterio.transform import from_bounds

from pipeline.ingest.extract import build_item, build_raster_auto


def _geotiff_bytes():
    arr = np.arange(16, dtype="uint8").reshape(1, 4, 4)
    transform = from_bounds(-1, -1, 1, 1, 4, 4)
    with MemoryFile() as mem:
        with mem.open(
            driver="GTiff", height=4, width=4, count=1, dtype="uint8",
            crs="EPSG:4326", transform=transform,
        ) as ds:
            ds.write(arr)
        return mem.read()


class _FakeS3:
    def __init__(self, objects):
        self.objects = objects

    def get_object(self, Bucket, Key):  # noqa: N803
        return {"Body": io.BytesIO(self.objects[(Bucket, Key)])}


def test_build_raster_auto_sets_geometry_and_href():
    members = [_member("scene.tif")]
    cfg = parse_metadata({"strategy": "raster_auto"})
    item = build_raster_auto("col", "scene", members, cfg, _geotiff_bytes(), "/api/assets")
    assert item["id"] == "scene"
    assert item["collection"] == "col"
    assert item["geometry"] is not None and item["geometry"]["type"] == "Polygon"
    assert item["bbox"] is not None
    assert item["assets"]["scene"]["href"] == "/api/assets/col/scene/scene.tif"
    assert "proj:epsg" in item["properties"] or "proj:code" in item["properties"]


async def test_build_item_dispatches_raster_auto_reads_from_storage():
    members = [_member("scene.tif")]
    s3 = _FakeS3({("bucket", "assets/col/scene/scene.tif"): _geotiff_bytes()})
    item = await build_item(
        collection_id="col", item_id="scene", members=members,
        metadata={"strategy": "raster_auto"}, s3_client=s3, bucket="bucket",
        asset_href_base="/api/assets",
    )
    assert item["geometry"] is not None


async def test_build_item_defaults_only_reads_nothing():
    members = [_member("scene.bin")]
    s3 = _FakeS3({})  # no objects — defaults_only must not read
    item = await build_item(
        collection_id="col", item_id="scene", members=members,
        metadata={"strategy": "defaults_only", "defaults": {"datetime": "2021-01-01T00:00:00Z"}},
        s3_client=s3, bucket="bucket", asset_href_base="/api/assets",
    )
    assert item["geometry"] is None
```

- [ ] **Step 2: Run to verify they fail**

Run: `uv run pytest tests/test_ingest_extract.py -k "raster or dispatch or defaults_only_reads" -v`
Expected: FAIL (cannot import `build_raster_auto` / `build_item`).

- [ ] **Step 3: Implement raster_auto + build_item**

Add to `extract.py`:

```python
import asyncio

from pipeline.storage import platform


def build_raster_auto(
    collection_id: str,
    item_id: str,
    members: list[ExtractMember],
    cfg: MetadataConfig,
    raster_bytes: bytes,
    asset_href_base: str,
) -> dict[str, Any]:
    """rio-stac over the primary raster (read from an in-memory file), with asset
    hrefs rewritten to the app route and all group members attached as assets."""
    import rasterio
    from rio_stac.stac import create_stac_item

    primary = _primary(members)
    when = resolve_datetime(None, cfg, primary) if cfg.default_datetime else None
    try:
        with rasterio.io.MemoryFile(raster_bytes) as mem, mem.open() as src:
            item = create_stac_item(
                source=src,
                id=item_id,
                collection=collection_id,
                input_datetime=when,  # None → rio-stac uses dataset/now
                asset_name=posixpath.splitext(primary.filename)[0],
                asset_href=asset_href(
                    collection_id, item_id, primary.filename, base=asset_href_base
                ),
                asset_roles=["data"],
                asset_media_type=media_type_for(primary.filename),
                with_proj=True,
                with_raster=True,
            )
    except Exception as exc:  # noqa: BLE001 — any rasterio/rio-stac failure → typed
        raise ExtractError(f"raster_auto extraction failed: {exc}") from exc

    # Attach non-primary members as additional assets.
    for m in members:
        if m.filename == primary.filename:
            continue
        key = posixpath.splitext(m.filename)[0]
        item.add_asset(
            key,
            __import__("pystac").Asset(
                href=asset_href(collection_id, item_id, m.filename, base=asset_href_base),
                media_type=media_type_for(m.filename),
                roles=["metadata"],
            ),
        )
    return item.to_dict(include_self_link=False, transform_hrefs=False)


async def build_item(
    *,
    collection_id: str,
    item_id: str,
    members: list[ExtractMember],
    metadata: dict[str, Any],
    s3_client: platform.S3Like,
    bucket: str,
    asset_href_base: str,
) -> dict[str, Any]:
    """Dispatch on metadata.strategy, reading member bytes from canonical storage
    only when the strategy needs them."""
    if not members:
        raise ExtractError("no members to itemize")
    cfg = parse_metadata(metadata)

    if cfg.strategy == "defaults_only":
        return build_defaults_only(collection_id, item_id, members, cfg, asset_href_base)

    if cfg.strategy == "sidecar":
        sidecar = _match_sidecar(members, cfg)
        data = await asyncio.to_thread(
            platform.get_object, s3_client, bucket, sidecar.canonical_key
        )
        return build_sidecar(collection_id, item_id, members, cfg, data, asset_href_base)

    # raster_auto
    primary = _primary(members)
    if not is_raster(primary.filename):
        # No raster to read — fall back to a null-geometry item.
        return build_defaults_only(collection_id, item_id, members, cfg, asset_href_base)
    data = await asyncio.to_thread(
        platform.get_object, s3_client, bucket, primary.canonical_key
    )
    return build_raster_auto(collection_id, item_id, members, cfg, data, asset_href_base)


def _match_sidecar(members: list[ExtractMember], cfg: MetadataConfig) -> ExtractMember:
    """Locate the sidecar member by pattern (`{basename}.xml` → suffix match)."""
    if cfg.sidecar_pattern:
        suffix = cfg.sidecar_pattern.split("}", 1)[-1]  # `{basename}.xml` → `.xml`
        for m in members:
            if m.filename.endswith(suffix) and not is_raster(m.filename):
                return m
    for m in members:
        if not is_raster(m.filename):
            return m
    raise ExtractError("sidecar strategy but no sidecar member found")
```

Note on `__import__("pystac")`: replace with a top-level `import pystac` at the module head — shown inline only to keep this block self-contained. Add `import pystac` to the imports and use `pystac.Asset(...)`.

- [ ] **Step 4: Clean up imports**

At the top of `extract.py`, ensure the module imports are: `asyncio`, `datetime as dt`, `json`, `posixpath`, `from defusedxml.ElementTree import fromstring as _xml_fromstring`, `from defusedxml.common import DefusedXmlException`, `from xml.etree.ElementTree import Element, ParseError` (types only), `import pystac`, `from dataclasses import dataclass`, `from typing import Any`, `from pipeline.storage import platform`, `from pipeline.storage.keys import asset_href`. Replace the inline `__import__("pystac")` with `pystac.Asset(...)`. (`rasterio` and `rio_stac` stay lazily imported inside `build_raster_auto` so importing the module is cheap and test collection doesn't require GDAL until a raster test runs.)

- [ ] **Step 5: Run to verify tests pass**

Run: `uv run pytest tests/test_ingest_extract.py -v && uv run ruff check`
Expected: PASS (all extract tests), ruff clean.

- [ ] **Step 6: Commit**

```bash
git add services/pipeline/src/pipeline/ingest/extract.py services/pipeline/tests/test_ingest_extract.py
git commit -m "feat(pipeline): EXTRACT raster_auto (rio-stac) + async build_item dispatch"
```

---

## Task 6: `PgstacWriter` seam (ABC + pypgstac impl + fake)

**Files:**
- Create: `services/pipeline/src/pipeline/stac/__init__.py` (empty)
- Create: `services/pipeline/src/pipeline/stac/pgstac_writer.py`
- Create: `tests/test_pgstac_writer.py`

**Interfaces:**
- Produces (consumed by Task 8, Task 10):
  - `class PgstacWriter(abc.ABC)` with `async upsert_items(self, items: Sequence[Mapping[str, Any]]) -> None`.
  - `class CollectionMissing(Exception)` — raised when the item's collection isn't in pgstac.
  - `@dataclass class PgPgstacWriter(PgstacWriter): dsn: str` — wraps pypgstac in `asyncio.to_thread`; translates the pgstac "Collection … is not present" error to `CollectionMissing`.

- [ ] **Step 1: Write failing test (structure + error translation, no DB)**

In `tests/test_pgstac_writer.py`:

```python
import pytest

from pipeline.stac.pgstac_writer import CollectionMissing, PgPgstacWriter, PgstacWriter


def test_pgpgstac_writer_is_a_writer():
    assert issubclass(PgPgstacWriter, PgstacWriter)


async def test_upsert_translates_collection_missing(monkeypatch):
    writer = PgPgstacWriter(dsn="postgresql://ignored")

    def _boom(items):
        raise Exception("Collection foo is not present in the database")

    monkeypatch.setattr(writer, "_upsert_sync", _boom)
    with pytest.raises(CollectionMissing):
        await writer.upsert_items([{"id": "x", "collection": "foo"}])


async def test_upsert_reraises_other_errors(monkeypatch):
    writer = PgPgstacWriter(dsn="postgresql://ignored")

    def _boom(items):
        raise RuntimeError("connection refused")

    monkeypatch.setattr(writer, "_upsert_sync", _boom)
    with pytest.raises(RuntimeError):
        await writer.upsert_items([{"id": "x", "collection": "foo"}])
```

- [ ] **Step 2: Run to verify it fails**

Run: `uv run pytest tests/test_pgstac_writer.py -v`
Expected: FAIL (module does not exist).

- [ ] **Step 3: Implement the seam**

`services/pipeline/src/pipeline/stac/__init__.py`: empty file.

`services/pipeline/src/pipeline/stac/pgstac_writer.py`:

```python
"""pypgstac upsert seam (ROADMAP §6.1 ITEMIZE).

`PgstacWriter` is the ABC ITEMIZE depends on (so it unit-tests against a fake).
`PgPgstacWriter` wraps pypgstac's synchronous `Loader.load_items(...,
Methods.upsert)` in `asyncio.to_thread`. ADR 0001: upsert writes item DATA only
(temp `ON COMMIT DROP` staging tables + pgstac's own `upsert_item` functions —
no DDL, no migrations). A missing collection is a permanent error surfaced as
`CollectionMissing` (→ group failed); anything else propagates so the job retries.
"""

from __future__ import annotations

import abc
import asyncio
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any


class CollectionMissing(Exception):
    """The item's `collection` does not exist in pgstac (create it first)."""


class PgstacWriter(abc.ABC):
    @abc.abstractmethod
    async def upsert_items(self, items: Sequence[Mapping[str, Any]]) -> None:
        """Upsert STAC item dicts into pgstac, replacing by id."""


@dataclass
class PgPgstacWriter(PgstacWriter):
    dsn: str

    async def upsert_items(self, items: Sequence[Mapping[str, Any]]) -> None:
        try:
            await asyncio.to_thread(self._upsert_sync, list(items))
        except CollectionMissing:
            raise
        except Exception as exc:  # noqa: BLE001
            if "is not present in the database" in str(exc):
                raise CollectionMissing(str(exc)) from exc
            raise

    def _upsert_sync(self, items: list[Mapping[str, Any]]) -> None:  # pragma: no cover
        from pypgstac.db import PgstacDB
        from pypgstac.load import Loader, Methods

        with PgstacDB(dsn=self.dsn) as db:
            Loader(db=db).load_items(items, insert_mode=Methods.upsert)
```

- [ ] **Step 4: Run to verify it passes**

Run: `uv run pytest tests/test_pgstac_writer.py -v && uv run ruff check`
Expected: PASS, ruff clean.

- [ ] **Step 5: Commit**

```bash
git add services/pipeline/src/pipeline/stac/ services/pipeline/tests/test_pgstac_writer.py
git commit -m "feat(pipeline): PgstacWriter seam over pypgstac upsert"
```

---

## Task 7: post-ingest source action (`leave` / `delete` / `move:<path>`)

**Files:**
- Create: `services/pipeline/src/pipeline/ingest/postingest.py`
- Test: `tests/test_ingest_postingest.py`

**Interfaces:**
- Produces (consumed by Task 8):
  - `async apply_post_ingest(adapter: StorageAdapter, config: IngestConfig, *, source_paths: Sequence[str]) -> None` — leave/delete/move; per-file errors are logged and swallowed (never raises).

- [ ] **Step 1: Write failing tests (fake adapter)**

In `tests/test_ingest_postingest.py`:

```python
from pipeline.ingest.config import parse_ingest_config
from pipeline.ingest.postingest import apply_post_ingest


class _FakeAdapter:
    protocol = "sftp"

    def __init__(self, files):
        self.files = dict(files)
        self.deleted = []
        self.put = {}

    async def get(self, path):
        return self.files[path]

    async def put(self, path, data):
        self.put[path] = data

    async def delete(self, path):
        self.deleted.append(path)
        self.files.pop(path, None)


def _cfg(post_ingest, source_path="/out"):
    return parse_ingest_config(
        {"source_path": source_path, "post_ingest": post_ingest}
    )


async def test_leave_is_noop():
    a = _FakeAdapter({"/out/scene.tif": b"x"})
    await apply_post_ingest(a, _cfg("leave"), source_paths=["scene.tif"])
    assert a.deleted == [] and a.put == {}


async def test_delete_removes_source():
    a = _FakeAdapter({"/out/scene.tif": b"x"})
    await apply_post_ingest(a, _cfg("delete"), source_paths=["scene.tif"])
    assert a.deleted == ["/out/scene.tif"]


async def test_move_copies_then_deletes():
    a = _FakeAdapter({"/out/scene.tif": b"x"})
    await apply_post_ingest(a, _cfg("move:/done"), source_paths=["scene.tif"])
    assert a.put == {"/done/scene.tif": b"x"}
    assert a.deleted == ["/out/scene.tif"]


async def test_errors_are_swallowed():
    class _Boom(_FakeAdapter):
        async def delete(self, path):
            raise OSError("gone")

    a = _Boom({"/out/scene.tif": b"x"})
    # must not raise
    await apply_post_ingest(a, _cfg("delete"), source_paths=["scene.tif"])
```

- [ ] **Step 2: Run to verify they fail**

Run: `uv run pytest tests/test_ingest_postingest.py -v`
Expected: FAIL (module does not exist).

- [ ] **Step 3: Implement `apply_post_ingest`**

```python
"""post-ingest source action (§5.1 `post_ingest`, §6.1 tail).

Runs once after a group is successfully itemized. `leave` (default) no-ops;
`delete` removes the source files; `move:<path>` copies each to `<path>/<name>`
then deletes the original. Non-fatal by design — the item is already catalogued,
so a failed source cleanup is logged (Phase 6 can alert) but never fails the job
or reverts the ledger. DISCOVER won't re-see moved/deleted files, so this can't
re-trigger.
"""

from __future__ import annotations

import logging
import posixpath
from collections.abc import Sequence

from pipeline.connections.adapters.base import StorageAdapter
from pipeline.ingest.config import IngestConfig
from pipeline.ingest.discover import source_fetch_path

logger = logging.getLogger(__name__)


async def apply_post_ingest(
    adapter: StorageAdapter, config: IngestConfig, *, source_paths: Sequence[str]
) -> None:
    action = config.post_ingest
    if action == "leave":
        return
    for relpath in source_paths:
        src = source_fetch_path(config.source_path, relpath)
        try:
            if action == "delete":
                await adapter.delete(src)
            elif action.startswith("move:"):
                target_dir = action[len("move:") :]
                dest = posixpath.join(target_dir, posixpath.basename(relpath))
                data = await adapter.get(src)
                await adapter.put(dest, data)
                await adapter.delete(src)
        except Exception:  # noqa: BLE001 — cleanup is best-effort
            logger.exception(
                "post-ingest action failed (non-fatal)",
                extra={"action": action, "source_path": src},
            )
```

- [ ] **Step 4: Run to verify tests pass**

Run: `uv run pytest tests/test_ingest_postingest.py -v && uv run ruff check`
Expected: PASS, ruff clean.

- [ ] **Step 5: Commit**

```bash
git add services/pipeline/src/pipeline/ingest/postingest.py services/pipeline/tests/test_ingest_postingest.py
git commit -m "feat(pipeline): post-ingest source action (leave/delete/move)"
```

---

## Task 8: ITEMIZE orchestrator (`run_itemize`)

**Files:**
- Create: `services/pipeline/src/pipeline/ingest/itemize.py`
- Test: `tests/test_ingest_itemize.py`

**Interfaces:**
- Consumes: `IngestRepo` + `LedgerEntry` + statuses (`ingest/repo.py`); `build_item`, `ExtractError`, `ExtractMember` (`ingest/extract.py`); `PgstacWriter`, `CollectionMissing` (`stac/pgstac_writer.py`); `apply_post_ingest` (`ingest/postingest.py`); `IngestConfig` (`ingest/config.py`); `StorageAdapter`; `platform.S3Like`.
- Produces (consumed by Task 9):
  - `@dataclass class ItemizeOutcome: status: str  # "itemized" | "failed" | "skipped"; item_id: str; detail: str = ""`.
  - `validate_item(item_dict: Mapping[str, Any]) -> None` — raises `ItemValidationError` on invalid.
  - `class ItemValidationError(Exception)`.
  - `async run_itemize(repo, writer, adapter, s3_client, *, association, config, item_id, source_paths, bucket, asset_href_base) -> ItemizeOutcome`.

- [ ] **Step 1: Write failing tests (fakes for repo/writer/adapter/s3)**

In `tests/test_ingest_itemize.py` — reuse the fake repo from `tests/_ingest_fake.py` (the existing `FakeRepo`). Add:

```python
import datetime as dt

import pytest

from pipeline.ingest.config import parse_ingest_config
from pipeline.ingest.itemize import (
    ItemizeOutcome,
    ItemValidationError,
    run_itemize,
    validate_item,
)
from pipeline.ingest.repo import STATUS_ITEMIZED, STATUS_FAILED, STATUS_STORED
from pipeline.stac.pgstac_writer import CollectionMissing, PgstacWriter
from tests._ingest_fake import FakeRepo, make_association  # assume helpers exist


class _FakeWriter(PgstacWriter):
    def __init__(self, raise_missing=False):
        self.items = []
        self.raise_missing = raise_missing

    async def upsert_items(self, items):
        if self.raise_missing:
            raise CollectionMissing("Collection col is not present in the database")
        self.items.extend(items)


class _FakeAdapter:
    protocol = "sftp"

    async def get(self, path):
        return b""

    async def put(self, path, data):
        pass

    async def delete(self, path):
        pass


class _FakeS3:
    def get_object(self, Bucket, Key):  # noqa: N803
        raise AssertionError("defaults_only must not read storage")


def _valid_item():
    return {
        "type": "Feature", "stac_version": "1.0.0", "stac_extensions": [],
        "id": "scene", "collection": "col", "geometry": None,
        "properties": {"datetime": "2021-01-01T00:00:00Z"}, "assets": {}, "links": [],
    }


def test_validate_item_accepts_null_geometry():
    validate_item(_valid_item())  # no raise


def test_validate_item_rejects_missing_datetime():
    bad = _valid_item()
    bad["properties"] = {}
    with pytest.raises(ItemValidationError):
        validate_item(bad)


async def test_run_itemize_defaults_only_upserts_and_marks_itemized():
    repo = FakeRepo()
    assoc = make_association(repo, collection_id="col", config={
        "source_path": "/out", "metadata": {"strategy": "defaults_only",
        "defaults": {"datetime": "2021-01-01T00:00:00Z"}}})
    ledger_id = await repo.insert_ledger_version(
        assoc.id, "scene.bin", version=1, status=STATUS_STORED, size=1, fingerprint="f")
    config = parse_ingest_config(assoc.config)
    writer = _FakeWriter()
    out = await run_itemize(
        repo, writer, _FakeAdapter(), _FakeS3(),
        association=assoc, config=config, item_id="scene",
        source_paths=["scene.bin"], bucket="b", asset_href_base="/api/assets")
    assert out.status == "itemized"
    assert writer.items and writer.items[0]["id"] == "scene"
    row = await repo.get_latest_ledger(assoc.id, "scene.bin")
    assert row.status == STATUS_ITEMIZED and row.item_id == "scene"


async def test_run_itemize_collection_missing_marks_failed():
    repo = FakeRepo()
    assoc = make_association(repo, collection_id="col", config={
        "source_path": "/out", "metadata": {"strategy": "defaults_only",
        "defaults": {"datetime": "2021-01-01T00:00:00Z"}}})
    await repo.insert_ledger_version(
        assoc.id, "scene.bin", version=1, status=STATUS_STORED, size=1, fingerprint="f")
    out = await run_itemize(
        repo, _FakeWriter(raise_missing=True), _FakeAdapter(), _FakeS3(),
        association=assoc, config=parse_ingest_config(assoc.config), item_id="scene",
        source_paths=["scene.bin"], bucket="b", asset_href_base="/api/assets")
    assert out.status == "failed"
    row = await repo.get_latest_ledger(assoc.id, "scene.bin")
    assert row.status == STATUS_FAILED


async def test_run_itemize_skips_when_no_stored_members():
    repo = FakeRepo()
    assoc = make_association(repo, collection_id="col", config={"source_path": "/out"})
    out = await run_itemize(
        repo, _FakeWriter(), _FakeAdapter(), _FakeS3(),
        association=assoc, config=parse_ingest_config(assoc.config), item_id="scene",
        source_paths=["scene.bin"], bucket="b", asset_href_base="/api/assets")
    assert out.status == "skipped"
```

Before writing the test, open `tests/_ingest_fake.py` and confirm the exact `FakeRepo` construction + how existing tests build an association (there may be a helper or inline construction). If there is no `make_association` helper, construct the `IngestAssociation` inline exactly as the existing `test_ingest_group.py` / `test_ingest_fetch.py` do, and register it in `FakeRepo`. Match the existing pattern rather than inventing `make_association`.

- [ ] **Step 2: Run to verify they fail**

Run: `uv run pytest tests/test_ingest_itemize.py -v`
Expected: FAIL (module does not exist).

- [ ] **Step 3: Implement `itemize.py`**

```python
"""ITEMIZE stage: validate + upsert a group's STAC item, then post-ingest (§6.1).

Orchestrates the chain tail against seams (repo, pgstac writer, adapter, S3
client) so it is fully unit-testable. Re-reads each source file's latest ledger
row and acts only on `stored` members (idempotent, restart-safe): a crash mid-run
leaves them `stored` for the re-enqueued job to re-upsert (upsert is idempotent).
EXTRACT failure or a validation failure marks the members `failed` (no bad item
reaches the catalog); a missing collection is a permanent `failed`. On success
the members go `itemized` and post-ingest cleans the source.
"""

from __future__ import annotations

import logging
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any

from pipeline.connections.adapters.base import StorageAdapter
from pipeline.ingest.config import IngestConfig
from pipeline.ingest.extract import ExtractError, ExtractMember, build_item
from pipeline.ingest.postingest import apply_post_ingest
from pipeline.ingest.repo import (
    STATUS_FAILED,
    STATUS_ITEMIZED,
    STATUS_STORED,
    IngestAssociation,
    IngestRepo,
    LedgerEntry,
)
from pipeline.storage import platform
from pipeline.storage.keys import canonical_asset_key
from pipeline.stac.pgstac_writer import CollectionMissing, PgstacWriter

logger = logging.getLogger(__name__)


class ItemValidationError(Exception):
    """The built item fails stac-pydantic validation."""


@dataclass
class ItemizeOutcome:
    status: str  # "itemized" | "failed" | "skipped"
    item_id: str
    detail: str = ""


def validate_item(item_dict: Mapping[str, Any]) -> None:
    """stac-pydantic gate (offline, core-structural). Raises on invalid."""
    from pydantic import ValidationError
    from stac_pydantic.api import Item

    try:
        Item.model_validate(dict(item_dict))
    except ValidationError as exc:
        raise ItemValidationError(str(exc)) from exc


def _member(entry: LedgerEntry, collection_id: str, item_id: str) -> ExtractMember:
    filename = entry.source_path.rsplit("/", 1)[-1]
    return ExtractMember(
        source_path=entry.source_path,
        filename=filename,
        canonical_key=canonical_asset_key(collection_id, item_id, filename),
        observed_at=entry.updated_at,
    )


async def _mark(repo: IngestRepo, entries: list[LedgerEntry], status: str, item_id: str | None) -> None:
    for e in entries:
        fields: dict[str, Any] = {"status": status}
        if item_id is not None:
            fields["item_id"] = item_id
        await repo.set_ledger_fields(e.id, **fields)


async def run_itemize(
    repo: IngestRepo,
    writer: PgstacWriter,
    adapter: StorageAdapter,
    s3_client: platform.S3Like,
    *,
    association: IngestAssociation,
    config: IngestConfig,
    item_id: str,
    source_paths: Sequence[str],
    bucket: str,
    asset_href_base: str,
) -> ItemizeOutcome:
    # Re-read: act only on members still `stored` (idempotent guard).
    stored: list[LedgerEntry] = []
    for sp in source_paths:
        row = await repo.get_latest_ledger(association.id, sp)
        if row is not None and row.status == STATUS_STORED:
            stored.append(row)
    if not stored:
        return ItemizeOutcome("skipped", item_id, "no stored members")

    members = [_member(e, association.collection_id, item_id) for e in stored]

    # EXTRACT
    try:
        item_dict = await build_item(
            collection_id=association.collection_id,
            item_id=item_id,
            members=members,
            metadata=config.metadata,
            s3_client=s3_client,
            bucket=bucket,
            asset_href_base=asset_href_base,
        )
    except ExtractError as exc:
        await _mark(repo, stored, STATUS_FAILED, None)
        logger.warning("itemize extract failed", extra={"item_id": item_id, "error": str(exc)})
        return ItemizeOutcome("failed", item_id, f"extract: {exc}")

    # VALIDATE
    try:
        validate_item(item_dict)
    except ItemValidationError as exc:
        await _mark(repo, stored, STATUS_FAILED, None)
        logger.warning("itemize validation failed", extra={"item_id": item_id, "error": str(exc)})
        return ItemizeOutcome("failed", item_id, f"validation: {exc}")

    # UPSERT
    try:
        await writer.upsert_items([item_dict])
    except CollectionMissing as exc:
        await _mark(repo, stored, STATUS_FAILED, None)
        logger.error("itemize upsert failed: collection missing", extra={"item_id": item_id})
        return ItemizeOutcome("failed", item_id, f"collection missing: {exc}")
    # Any other exception propagates → the job retries (transient DB errors).

    await _mark(repo, stored, STATUS_ITEMIZED, item_id)

    # post-ingest (non-fatal)
    await apply_post_ingest(adapter, config, source_paths=[e.source_path for e in stored])

    logger.info("itemize done", extra={"item_id": item_id, "members": len(stored)})
    return ItemizeOutcome("itemized", item_id)
```

- [ ] **Step 4: Run to verify tests pass**

Run: `uv run pytest tests/test_ingest_itemize.py -v && uv run ruff check`
Expected: PASS, ruff clean. (If `FakeRepo` lacks a needed method, extend the fake in `tests/_ingest_fake.py` to match the `IngestRepo` ABC — mirror the existing methods.)

- [ ] **Step 5: Commit**

```bash
git add services/pipeline/src/pipeline/ingest/itemize.py services/pipeline/tests/test_ingest_itemize.py services/pipeline/tests/_ingest_fake.py
git commit -m "feat(pipeline): ITEMIZE orchestrator (validate + upsert + ledger + post-ingest)"
```

---

## Task 9: Job wiring — FETCH → ITEMIZE, register `pipeline.ingest_itemize`

**Files:**
- Modify: `services/pipeline/src/pipeline/jobs/ingest.py`
- Test: `tests/test_ingest_jobs.py` (extend), `tests/test_main_jobs.py` (extend)

**Interfaces:**
- Consumes: everything from Tasks 5–8 + existing `build_adapter`, `build_platform_client`, `_load_association`, `load_key_or_skip`.
- Produces: a registered task `pipeline.ingest_itemize` (constant `JOB_ITEMIZE`); FETCH enqueues it per group when `stored > 0`.

- [ ] **Step 1: Read the current wiring + tests**

Open `jobs/ingest.py` and `tests/test_ingest_jobs.py`, `tests/test_main_jobs.py`. Note how existing tests assert task registration and enqueues (they likely use the in-memory queue / a fake). Mirror that exact style.

- [ ] **Step 2: Write failing test — FETCH enqueues ITEMIZE; task registered**

The existing tests use `InMemoryQueue` (`queue.tasks[name]` holds each handler closure; `queue.jobs` records enqueues as `Job(name, payload)`). Add to `tests/test_ingest_jobs.py`:

```python
from pipeline.ingest.config import parse_ingest_config
from pipeline.ingest.repo import IngestAssociation
from pipeline.jobs.ingest import JOB_ITEMIZE


def test_register_includes_itemize_task():
    queue = InMemoryQueue()
    ingest.register(queue, Settings.from_env(env={}))
    assert JOB_ITEMIZE in queue.tasks


async def test_fetch_handler_enqueues_itemize_when_stored(monkeypatch):
    queue = InMemoryQueue()
    settings = Settings.from_env(env={})
    ingest.register(queue, settings)

    assoc = IngestAssociation(
        id="a1", collection_id="col", config={"source_path": "/o"}, connection=None
    )
    config = parse_ingest_config({"source_path": "/o"})

    async def _fake_load(_settings, _aid):
        return (object(), assoc, config)

    async def _fake_fetch_stage(*_a, **_k):
        return 1  # one file stored → must enqueue itemize

    monkeypatch.setattr(ingest, "load_key_or_skip", lambda _s, _j: b"key")
    monkeypatch.setattr(ingest, "_load_association", _fake_load)
    monkeypatch.setattr(ingest, "build_adapter", lambda *_a, **_k: object())
    monkeypatch.setattr(ingest, "build_platform_client", lambda _s: object())
    monkeypatch.setattr(ingest, "fetch_stage", _fake_fetch_stage)

    await queue.tasks["pipeline.ingest_fetch"](
        association_id="a1", item_id="scene", source_paths=["scene.tif"]
    )

    itemize = [j for j in queue.jobs if j.name == JOB_ITEMIZE]
    assert len(itemize) == 1
    assert itemize[0].payload == {
        "association_id": "a1",
        "item_id": "scene",
        "source_paths": ["scene.tif"],
    }


async def test_fetch_handler_skips_itemize_when_nothing_stored(monkeypatch):
    queue = InMemoryQueue()
    settings = Settings.from_env(env={})
    ingest.register(queue, settings)
    assoc = IngestAssociation(
        id="a1", collection_id="col", config={"source_path": "/o"}, connection=None
    )
    config = parse_ingest_config({"source_path": "/o"})

    async def _fake_load(_settings, _aid):
        return (object(), assoc, config)

    async def _fake_fetch_stage(*_a, **_k):
        return 0  # nothing stored → no itemize enqueue

    monkeypatch.setattr(ingest, "load_key_or_skip", lambda _s, _j: b"key")
    monkeypatch.setattr(ingest, "_load_association", _fake_load)
    monkeypatch.setattr(ingest, "build_adapter", lambda *_a, **_k: object())
    monkeypatch.setattr(ingest, "build_platform_client", lambda _s: object())
    monkeypatch.setattr(ingest, "fetch_stage", _fake_fetch_stage)

    await queue.tasks["pipeline.ingest_fetch"](
        association_id="a1", item_id="scene", source_paths=["scene.tif"]
    )
    assert not [j for j in queue.jobs if j.name == JOB_ITEMIZE]
```

Also update `test_register_wires_poll_periodic_and_stage_tasks` in the same file: the expected task set becomes `{JOB_DISCOVER, JOB_GROUP, JOB_FETCH, JOB_ITEMIZE}` (import `JOB_ITEMIZE`). And update `test_build_queue_includes_ingest_jobs` in this file + the equivalent assertion in `tests/test_main_jobs.py` to include `JOB_ITEMIZE`.

- [ ] **Step 3: Run to verify it fails**

Run: `uv run pytest tests/test_ingest_jobs.py -k itemize -v`
Expected: FAIL (no such enqueue / task).

- [ ] **Step 4: Implement wiring in `jobs/ingest.py`**

Add the constant near the others:

```python
JOB_ITEMIZE = "pipeline.ingest_itemize"
```

Add imports:

```python
from pipeline.ingest.itemize import run_itemize
from pipeline.stac.pgstac_writer import PgPgstacWriter
```

In the `fetch` handler, after `fetch_stage(...)` returns `stored`, enqueue ITEMIZE when something stored:

```python
        stored = await fetch_stage(
            repo, association, config, adapter, s3_client,
            settings.staging_bucket, item_id, source_paths,
        )
        if stored:
            await queue.enqueue(
                JOB_ITEMIZE,
                {"association_id": association_id, "item_id": item_id,
                 "source_paths": source_paths},
            )
```

(Adjust: `fetch_stage` currently returns the stored count — confirm and use it. If the current `fetch` handler discards the return, capture it.)

Add the ITEMIZE handler and register it:

```python
    async def itemize(association_id: str, item_id: str, source_paths: list[str]) -> None:
        master_key = load_key_or_skip(settings, JOB_ITEMIZE)
        if master_key is None:
            return
        loaded = await _load_association(settings, association_id)
        if loaded is None:
            return
        repo, association, config = loaded
        adapter = build_adapter(
            association.connection, master_key, settings.egress_allow_hosts
        )
        s3_client = build_platform_client(settings)
        writer = PgPgstacWriter(settings.database_url)
        await run_itemize(
            repo, writer, adapter, s3_client,
            association=association, config=config, item_id=item_id,
            source_paths=source_paths, bucket=settings.staging_bucket,
            asset_href_base=settings.asset_href_base,
        )

    queue.register_task(itemize, name=JOB_ITEMIZE)
```

- [ ] **Step 5: Run to verify tests pass**

Run: `uv run pytest tests/test_ingest_jobs.py tests/test_main_jobs.py -v && uv run ruff check`
Expected: PASS, ruff clean.

- [ ] **Step 6: Run the full pipeline unit suite**

Run: `uv run pytest -q && uv run ruff check`
Expected: all pass (should be ~180+ tests now), ruff clean.

- [ ] **Step 7: Commit**

```bash
git add services/pipeline/src/pipeline/jobs/ingest.py services/pipeline/tests/test_ingest_jobs.py services/pipeline/tests/test_main_jobs.py
git commit -m "feat(pipeline): wire FETCH -> ingest_itemize stage job"
```

---

## Task 10: DB integration test — real pypgstac upsert → queryable item

**Files:**
- Modify: `services/pipeline/tests/test_integration_db.py` (add a test) OR create `tests/test_integration_itemize.py` following the same skip guard.

**Interfaces:**
- Consumes: `PgPgstacWriter`, live pgstac at `DATABASE_URL`.

- [ ] **Step 1: Write the integration test (auto-skips without `DATABASE_URL`)**

Create `tests/test_integration_itemize.py`:

```python
"""pypgstac upsert integration — auto-skips unless DATABASE_URL is set.

Requires the compose stack (pgstac at :5433) with a test collection present.

    DATABASE_URL=postgresql://username:password@localhost:5433/postgis \
        uv run pytest tests/test_integration_itemize.py
"""

import os

import psycopg
import pytest

DATABASE_URL = os.environ.get("DATABASE_URL")
pytestmark = pytest.mark.skipif(not DATABASE_URL, reason="DATABASE_URL not set")

COLLECTION = "b4-itest"


def _item(item_id, dtstr):
    return {
        "type": "Feature", "stac_version": "1.0.0", "stac_extensions": [],
        "id": item_id, "collection": COLLECTION, "geometry": None,
        "properties": {"datetime": dtstr}, "assets": {}, "links": [],
    }


@pytest.fixture
async def collection():
    # Insert a minimal collection via pgstac's create_collection, clean up after.
    coll = {
        "type": "Collection", "stac_version": "1.0.0", "id": COLLECTION,
        "description": "b4 itest", "license": "proprietary",
        "extent": {"spatial": {"bbox": [[-180, -90, 180, 90]]},
                   "temporal": {"interval": [[None, None]]}}, "links": [],
    }
    async with await psycopg.AsyncConnection.connect(DATABASE_URL, autocommit=True) as conn:
        await conn.execute("SELECT pgstac.create_collection(%s::jsonb)", (__import__("json").dumps(coll),))
    yield COLLECTION
    async with await psycopg.AsyncConnection.connect(DATABASE_URL, autocommit=True) as conn:
        await conn.execute("SELECT pgstac.delete_collection(%s)", (COLLECTION,))


async def test_upsert_then_query_and_update(collection):
    from pipeline.stac.pgstac_writer import PgPgstacWriter

    writer = PgPgstacWriter(DATABASE_URL)
    await writer.upsert_items([_item("scene-1", "2021-01-01T00:00:00Z")])

    async with await psycopg.AsyncConnection.connect(DATABASE_URL, autocommit=True) as conn:
        cur = await conn.execute(
            "SELECT content->'properties'->>'datetime' FROM pgstac.items"
            " WHERE id = 'scene-1' AND collection = %s", (COLLECTION,))
        row = await cur.fetchone()
    assert row is not None and row[0].startswith("2021-01-01")

    # Upsert same id with a new datetime → update in place.
    await writer.upsert_items([_item("scene-1", "2022-02-02T00:00:00Z")])
    async with await psycopg.AsyncConnection.connect(DATABASE_URL, autocommit=True) as conn:
        cur = await conn.execute(
            "SELECT content->'properties'->>'datetime' FROM pgstac.items WHERE id = 'scene-1'")
        row = await cur.fetchone()
    assert row[0].startswith("2022-02-02")
```

- [ ] **Step 2: Run it against the live stack**

Ensure the stack is up (`docker compose up -d --wait`), then:
Run: `DATABASE_URL=postgresql://username:password@localhost:5433/postgis uv run pytest tests/test_integration_itemize.py -v`
Expected: PASS (upsert, query returns the row, second upsert updates it). If pgstac's collection helper name differs by version, adjust to the exact function (`pgstac.create_collection` / `pgstac.upsert_collection`) — verify with `\df pgstac.*collection*` in psql.

- [ ] **Step 3: Confirm it skips cleanly without the env**

Run: `uv run pytest tests/test_integration_itemize.py -v`
Expected: SKIPPED (no `DATABASE_URL`).

- [ ] **Step 4: Commit**

```bash
git add services/pipeline/tests/test_integration_itemize.py
git commit -m "test(pipeline): DB integration — pypgstac upsert -> queryable + updatable item"
```

---

## Task 11: ADR 0006 + docs (ROADMAP / FEATURES / ISSUES / README)

**Files:**
- Create: `docs/decisions/0006-ingest-metadata-and-upsert.md`
- Modify: `ROADMAP.md` (Slice B4 → done; B5 gap update), `docs/FEATURES.md`, `docs/ISSUES.md`, `services/pipeline/README.md`, `docs/decisions/README.md` (ADR index/invariants)

- [ ] **Step 1: Write ADR 0006**

Create `docs/decisions/0006-ingest-metadata-and-upsert.md` with: Status accepted (Phase 4); Context (EXTRACT/ITEMIZE need metadata extraction + a pgstac writer); Decision (rio-stac/pystac/stac-pydantic/pypgstac with the pinned versions; self-contained rasterio wheels so no system GDAL / no Dockerfile change; pgstac image pinned to v0.9.11 for client/schema lockstep; stac-pydantic-only validation gate in the hot path; `Methods.upsert` writes item data only → ADR-0001-compatible, verified it runs no DDL/migrations); Consequences (image +~200 MB; pgstac upgrades must bump the pin + re-test; bundled-GDAL driver subset; `file_mtime` approximated by ledger settle time). Follow the structure of `docs/decisions/0005-asset-service.md`.

- [ ] **Step 2: Update the ROADMAP**

In `ROADMAP.md`: change the Slice B4 bullet from ⬜ NEXT to ✅ done (summarize: three strategies, stac-pydantic gate, pypgstac upsert, post-ingest, no Dockerfile change, pgstac pin, ADR 0006). Update the Phase-4 status row and the B5 line — the queryable-item + changed→updated assertions are now met (once Task 12 runs live); leave the SFTP/FTP-source run (I-4) as the remaining B5 item. Update the "Implementation status" table Phase 4 note.

- [ ] **Step 3: Update FEATURES + ISSUES + README**

- `docs/FEATURES.md`: add the EXTRACT/ITEMIZE/post-ingest entry points under Phase 4.
- `docs/ISSUES.md`: log (a) `file_mtime` approximation (ledger settle time, true-mtime column is a future app migration), (b) pgstac version lockstep on upgrade, (c) bundled-GDAL driver subset boundary, (d) sidecar `generic_xml` minimal field set, (e) memory-buffered raster reads (link I-19).
- `services/pipeline/README.md`: document `ASSET_HREF_BASE`, the new deps, and the ITEMIZE stage in the ingest flow section.

- [ ] **Step 4: Commit**

```bash
git add docs/decisions/0006-ingest-metadata-and-upsert.md docs/decisions/README.md ROADMAP.md docs/FEATURES.md docs/ISSUES.md services/pipeline/README.md
git commit -m "docs: ADR 0006 + Phase 4 Slice B4 status (EXTRACT + ITEMIZE)"
```

---

## Task 12: Live end-to-end verification (closes the B5 gap)

**Files:** none (verification task). Use the `verify` skill / the repo's e2e conventions. Record the outcome in the ROADMAP B5 line.

**Preconditions:** full stack up (`docker compose up -d --wait` incl. MinIO + pgstac + pipeline), the compose test-servers (`infra/compose.test-servers.yml`) OR an S3/MinIO source, and a built-in-catalog collection to ingest into. `CREDENTIALS_MASTER_KEY` shared app↔pipeline. Follow the B2+B3 live-verification recipe already recorded in the ROADMAP/commit history (the copy chain was verified this way).

- [ ] **Step 1: Bring up the stack and create a collection + ingest association**

Create (or reuse) a built-in-catalog collection, an s3 connection pointing at a MinIO source bucket, and an enabled `ingest` association with `storage_mode: copy` and `metadata.strategy: raster_auto` (via the app's Data-flow UI or a direct API call). Drop a real single-band GeoTIFF into the source path.

- [ ] **Step 2: Drive one poll cycle and assert a queryable item**

Trigger the poll (wait for the `ingest_poll` cron tick, or enqueue `pipeline.ingest_poll` manually). Watch the ledger advance `seen → settled → stored → itemized` (query `stac_higher.ingest_files`). Then query the catalog:

Run: `curl -s "http://localhost:8081/collections/<COLLECTION>/items/<ITEM_ID>" | jq '{id, geometry: (.geometry.type), dt: .properties.datetime, asset: .assets}'`
Expected: the item exists, has a non-null Polygon geometry (raster_auto), a datetime, and an asset href of the form `/api/assets/<COLLECTION>/<ITEM_ID>/<filename>`.

- [ ] **Step 3: Assert the asset resolves through the app route**

Run: `curl -si "http://localhost:4321/api/assets/<COLLECTION>/<ITEM_ID>/<filename>"`
Expected: `302` redirect to a presigned MinIO URL; following it returns the original bytes (sha256 matches the source).

- [ ] **Step 4: Assert a changed source file updates the same item**

Replace the source file with a modified raster (different bytes). Drive two poll cycles (settled-check needs two). Re-query the item:
Expected: same `id`, updated content (e.g. changed datetime/geometry/checksum), ledger `version` incremented to 2, status `itemized`.

- [ ] **Step 5: Record the result**

Update the ROADMAP B5 line to mark the queryable-item + changed→updated assertions live-verified with the date, mirroring the existing B2+B3 live-verification note. Commit.

```bash
git add ROADMAP.md
git commit -m "docs: record Phase 4 B4/B5 live end-to-end verification (raster ingest)"
```

- [ ] **Step 6: Final full verify before merge**

Run (in `services/pipeline/`): `uv run pytest -q && uv run ruff check`
Run (repo root): `npm run verify`
Expected: pipeline suite green + ruff clean; app build + unit tests green.

---

## Merge

After all tasks pass on the worktree branch:

```bash
git checkout ai/main
git merge ai/phase4-b4 --no-ff
# resolve package-lock.json conflicts per AGENTS.md if any; re-run verify on ai/main
git worktree remove .claude/worktrees/phase4-b4
git branch -d ai/phase4-b4
```

Run `npm run verify` (and the pipeline suite) once more on `ai/main`. Push if running unattended.

---

## Self-Review notes (author)

- **Spec coverage:** deps/Docker/pin/ADR → T1, T11; asset href + get_object + setting → T2; EXTRACT 3 strategies → T3/T4/T5; validation gate → T8; pypgstac seam → T6; ledger transitions + idempotency + collection-missing → T8; post-ingest → T7; re-ingest/update → covered by existing DISCOVER versioning, asserted in T12 step 4; job wiring → T9; unit + DB-integration + live e2e testing → T3–T10, T12. All spec §12 test buckets present.
- **`file_mtime` approximation, pgstac pin, bundled-GDAL boundary, sidecar field set, memory-buffered reads** → all logged in T11 ISSUES step, per spec §13.
- **Type consistency:** `build_item(...)` async signature is identical in T5 (definition) and T8 (call site); `ExtractMember` fields (`source_path/filename/canonical_key/observed_at`) consistent T3→T8; `run_itemize(...)` signature identical T8 (def) and T9 (call); `PgstacWriter.upsert_items` / `CollectionMissing` consistent T6→T8→T10; `apply_post_ingest(adapter, config, *, source_paths)` consistent T7→T8.
- **Fakes:** T8 relies on the existing `tests/_ingest_fake.py::FakeRepo`; the plan flags verifying/extending it to satisfy the `IngestRepo` ABC rather than inventing a divergent fake.
