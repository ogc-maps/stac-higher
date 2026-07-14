"""JSON log formatter."""

import json
import logging

from pipeline.log import JsonFormatter


def make_record(**extra) -> logging.LogRecord:
    record = logging.LogRecord(
        name="pipeline.test",
        level=logging.INFO,
        pathname=__file__,
        lineno=1,
        msg="hello %s",
        args=("world",),
        exc_info=None,
    )
    for key, value in extra.items():
        setattr(record, key, value)
    return record


def test_formats_single_json_line():
    line = JsonFormatter().format(make_record())
    payload = json.loads(line)
    assert payload["message"] == "hello world"
    assert payload["level"] == "INFO"
    assert payload["logger"] == "pipeline.test"
    assert "T" in payload["timestamp"]
    assert "\n" not in line


def test_extra_fields_included():
    payload = json.loads(JsonFormatter().format(make_record(heartbeat_count=3)))
    assert payload["heartbeat_count"] == 3


def test_non_serializable_extra_stringified():
    payload = json.loads(JsonFormatter().format(make_record(obj={1, 2})))
    assert isinstance(payload["obj"], str)


def test_exception_included():
    try:
        raise ValueError("boom")
    except ValueError:
        import sys

        record = make_record()
        record.exc_info = sys.exc_info()
    payload = json.loads(JsonFormatter().format(record))
    assert "ValueError: boom" in payload["exception"]
