"""S3 adapter — boto3 driven, run off the event loop via ``asyncio.to_thread``.

Honors a custom ``endpoint`` (e.g. MinIO), ``region``, and
``force_path_style``. ``test()`` performs a HEAD-bucket (falling back to a
1-key list) so it proves both reachability and auth without listing the world.
"""

from __future__ import annotations

import asyncio
import time
from typing import Any
from urllib.parse import urlparse

import boto3
from botocore.client import Config
from botocore.exceptions import BotoCoreError, ClientError

from pipeline.connections.adapters.base import StorageAdapter, TestResult
from pipeline.connections.egress import EgressBlocked, enforce


def _endpoint_host(endpoint: str | None, region: str | None) -> str:
    """The hostname the egress policy must vet before any S3 call.

    With a custom endpoint, use its host. Otherwise use AWS's public regional
    endpoint (a global/public address — the policy will allow it).
    """
    if endpoint:
        parsed = urlparse(endpoint)
        host = parsed.hostname
        if not host:
            raise EgressBlocked(f"S3 endpoint has no host: {endpoint!r}")
        return host
    if region:
        return f"s3.{region}.amazonaws.com"
    return "s3.amazonaws.com"


class S3Adapter(StorageAdapter):
    protocol = "s3"

    def __init__(
        self,
        config: dict[str, Any],
        credentials: dict[str, Any],
        allow_hosts: frozenset[str] = frozenset(),
    ) -> None:
        self._bucket = config["bucket"]
        self._region = config.get("region")
        self._endpoint = config.get("endpoint")
        self._force_path_style = bool(config.get("force_path_style", False))
        self._creds = credentials
        self._allow_hosts = allow_hosts

    def _host(self) -> str:
        return _endpoint_host(self._endpoint, self._region)

    def _make_client(self) -> Any:
        boto_config = Config(
            s3={"addressing_style": "path" if self._force_path_style else "auto"},
            connect_timeout=10,
            read_timeout=30,
            retries={"max_attempts": 2},
        )
        return boto3.client(
            "s3",
            region_name=self._region,
            endpoint_url=self._endpoint,
            aws_access_key_id=self._creds.get("access_key_id"),
            aws_secret_access_key=self._creds.get("secret_access_key"),
            aws_session_token=self._creds.get("session_token"),
            config=boto_config,
        )

    async def test(self) -> TestResult:
        started = time.monotonic()
        try:
            enforce(self._host(), self._allow_hosts)
        except EgressBlocked as exc:
            return {"ok": False, "message": str(exc)}

        def _probe() -> None:
            client = self._make_client()
            try:
                client.head_bucket(Bucket=self._bucket)
            except ClientError:
                # HEAD may be denied even when the bucket is usable; a bounded
                # list still proves reachability + auth.
                client.list_objects_v2(Bucket=self._bucket, MaxKeys=1)

        try:
            await asyncio.to_thread(_probe)
        except (ClientError, BotoCoreError) as exc:
            return {"ok": False, "message": f"S3 test failed: {exc}"}
        latency_ms = int((time.monotonic() - started) * 1000)
        return {
            "ok": True,
            "message": f"bucket {self._bucket!r} reachable",
            "latency_ms": latency_ms,
        }

    async def list(self, prefix: str = "") -> list[str]:
        enforce(self._host(), self._allow_hosts)

        def _list() -> list[str]:
            client = self._make_client()
            paginator = client.get_paginator("list_objects_v2")
            keys: list[str] = []
            for page in paginator.paginate(Bucket=self._bucket, Prefix=prefix):
                keys.extend(obj["Key"] for obj in page.get("Contents", []))
            return keys

        return await asyncio.to_thread(_list)

    async def get(self, path: str) -> bytes:
        enforce(self._host(), self._allow_hosts)

        def _get() -> bytes:
            client = self._make_client()
            resp = client.get_object(Bucket=self._bucket, Key=path)
            return resp["Body"].read()

        return await asyncio.to_thread(_get)

    async def put(self, path: str, data: bytes) -> None:
        enforce(self._host(), self._allow_hosts)

        def _put() -> None:
            client = self._make_client()
            client.put_object(Bucket=self._bucket, Key=path, Body=data)

        await asyncio.to_thread(_put)

    async def delete(self, path: str) -> None:
        enforce(self._host(), self._allow_hosts)

        def _delete() -> None:
            client = self._make_client()
            client.delete_object(Bucket=self._bucket, Key=path)

        await asyncio.to_thread(_delete)
