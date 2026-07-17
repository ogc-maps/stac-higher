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
