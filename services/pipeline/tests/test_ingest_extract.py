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
