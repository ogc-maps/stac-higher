"""Adapter ``test()`` behaviour with fully mocked clients — no live servers.

Each adapter's ``enforce`` symbol is monkeypatched to a spy so we assert the
egress gate is invoked with the config host, without touching real DNS.
"""

from __future__ import annotations

import pathlib
from typing import ClassVar

import pytest

from pipeline.connections.adapters import (
    FtpAdapter,
    FtpsAdapter,
    S3Adapter,
    SftpAdapter,
    adapter_for,
)
from pipeline.connections.adapters import ftp as ftp_mod
from pipeline.connections.adapters import ftps as ftps_mod
from pipeline.connections.adapters import s3 as s3_mod
from pipeline.connections.adapters import sftp as sftp_mod
from pipeline.connections.egress import EgressBlocked


class _EgressSpy:
    def __init__(self, blocked: bool = False):
        self.calls: list[str] = []
        self.blocked = blocked

    def __call__(self, host, allow_hosts=()):
        self.calls.append(host)
        if self.blocked:
            raise EgressBlocked(f"blocked: {host}")


# --------------------------------------------------------------------------- #
# S3
# --------------------------------------------------------------------------- #


class _FakeS3Client:
    def __init__(self, *, head_error: Exception | None = None):
        self._head_error = head_error
        self.head_called = False
        self.list_called = False

    def head_bucket(self, Bucket):
        self.head_called = True
        if self._head_error:
            raise self._head_error

    def list_objects_v2(self, Bucket, MaxKeys=None):
        self.list_called = True
        return {"Contents": []}


async def test_s3_test_ok(monkeypatch):
    spy = _EgressSpy()
    monkeypatch.setattr(s3_mod, "enforce", spy)
    fake = _FakeS3Client()
    monkeypatch.setattr(s3_mod.boto3, "client", lambda *a, **k: fake)

    adapter = S3Adapter(
        {"bucket": "b", "region": "us-east-1"}, {"access_key_id": "x", "secret_access_key": "y"}
    )
    result = await adapter.test()

    assert result["ok"] is True
    assert "latency_ms" in result
    assert fake.head_called
    assert spy.calls == ["s3.us-east-1.amazonaws.com"]


async def test_s3_endpoint_host_used_for_egress(monkeypatch):
    spy = _EgressSpy()
    monkeypatch.setattr(s3_mod, "enforce", spy)
    monkeypatch.setattr(s3_mod.boto3, "client", lambda *a, **k: _FakeS3Client())

    adapter = S3Adapter(
        {"bucket": "b", "endpoint": "https://minio:9000", "force_path_style": True},
        {"access_key_id": "x", "secret_access_key": "y"},
        allow_hosts=frozenset({"minio"}),
    )
    await adapter.test()
    assert spy.calls == ["minio"]


async def test_s3_test_failure(monkeypatch):
    from botocore.exceptions import ClientError

    monkeypatch.setattr(s3_mod, "enforce", _EgressSpy())
    err = ClientError({"Error": {"Code": "403", "Message": "denied"}}, "HeadBucket")
    fake = _FakeS3Client(head_error=err)

    def _list_fail(Bucket, MaxKeys=None):
        raise ClientError({"Error": {"Code": "404", "Message": "no bucket"}}, "ListObjectsV2")

    fake.list_objects_v2 = _list_fail
    monkeypatch.setattr(s3_mod.boto3, "client", lambda *a, **k: fake)

    adapter = S3Adapter({"bucket": "b"}, {"access_key_id": "x", "secret_access_key": "y"})
    result = await adapter.test()
    assert result["ok"] is False
    assert "failed" in result["message"]


async def test_s3_egress_blocked_short_circuits(monkeypatch):
    monkeypatch.setattr(s3_mod, "enforce", _EgressSpy(blocked=True))
    # boto3.client must never be called when egress blocks.
    monkeypatch.setattr(
        s3_mod.boto3, "client", lambda *a, **k: pytest.fail("client built despite block")
    )
    adapter = S3Adapter({"bucket": "b"}, {"access_key_id": "x", "secret_access_key": "y"})
    result = await adapter.test()
    assert result["ok"] is False
    assert "blocked" in result["message"]


# --------------------------------------------------------------------------- #
# SFTP / SSH
# --------------------------------------------------------------------------- #


class _FakeHostKey:
    def export_public_key(self, fmt):
        assert fmt == "openssh"
        return b"ssh-ed25519 AAAAOBSERVEDKEY comment-here"


class _FakeSFTP:
    def __init__(self):
        self.stat_path = None

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    async def stat(self, path):
        self.stat_path = path


class _FakeSSHConn:
    def __init__(self, sftp):
        self._sftp = sftp

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    def get_server_host_key(self):
        return _FakeHostKey()

    def start_sftp_client(self):
        return self._sftp


async def test_sftp_test_ok_exposes_host_key(monkeypatch):
    spy = _EgressSpy()
    monkeypatch.setattr(sftp_mod, "enforce", spy)
    sftp = _FakeSFTP()

    async def _connect(**kwargs):
        assert kwargs["known_hosts"] is None
        return _FakeSSHConn(sftp)

    monkeypatch.setattr(sftp_mod.asyncssh, "connect", _connect)

    adapter = SftpAdapter(
        {"host": "sftp.example", "port": 22, "root_path": "/incoming"},
        {"username": "u", "password": "p"},
        protocol="sftp",
    )
    result = await adapter.test()

    assert result["ok"] is True
    assert result["host_key"] == "ssh-ed25519 AAAAOBSERVEDKEY"
    assert "latency_ms" in result
    assert sftp.stat_path == "/incoming"
    assert spy.calls == ["sftp.example"]


async def test_sftp_test_failure(monkeypatch):
    monkeypatch.setattr(sftp_mod, "enforce", _EgressSpy())

    async def _connect(**kwargs):
        raise OSError("connection refused")

    monkeypatch.setattr(sftp_mod.asyncssh, "connect", _connect)
    adapter = SftpAdapter({"host": "h"}, {"username": "u", "password": "p"})
    result = await adapter.test()
    assert result["ok"] is False
    assert "SFTP test failed" in result["message"]


async def test_sftp_egress_blocked(monkeypatch):
    monkeypatch.setattr(sftp_mod, "enforce", _EgressSpy(blocked=True))

    async def _connect(**kwargs):  # pragma: no cover - must not run
        pytest.fail("connected despite egress block")

    monkeypatch.setattr(sftp_mod.asyncssh, "connect", _connect)
    adapter = SftpAdapter({"host": "internal"}, {"username": "u", "password": "p"})
    result = await adapter.test()
    assert result["ok"] is False
    assert "blocked" in result["message"]


# --------------------------------------------------------------------------- #
# FTP / FTPS
# --------------------------------------------------------------------------- #


class _FakeFtpClient:
    instances: ClassVar[list[_FakeFtpClient]] = []

    def __init__(self, *args, **kwargs):
        self.kwargs = kwargs
        self.connected = None
        self.logged_in = None
        self.listed = None
        self.quit_called = False
        self.upgraded = False
        _FakeFtpClient.instances.append(self)

    async def connect(self, host, port):
        self.connected = (host, port)

    async def login(self, user="anonymous", password=""):
        self.logged_in = (user, password)

    async def upgrade_to_tls(self, sslcontext=None):
        self.upgraded = True

    async def list(self, path=""):
        self.listed = path
        return [(pathlib.PurePosixPath("a.txt"), {"type": "file"})]

    async def quit(self):
        self.quit_called = True

    def close(self):
        pass


@pytest.fixture(autouse=True)
def _reset_ftp_instances():
    _FakeFtpClient.instances = []
    yield


async def test_ftp_test_ok(monkeypatch):
    spy = _EgressSpy()
    monkeypatch.setattr(ftp_mod, "enforce", spy)
    monkeypatch.setattr(ftp_mod.aioftp, "Client", _FakeFtpClient)

    adapter = FtpAdapter(
        {"host": "ftp.example", "port": 21, "root_path": "/pub"},
        {"username": "u", "password": "p"},
    )
    result = await adapter.test()

    assert result["ok"] is True
    assert "latency_ms" in result
    client = _FakeFtpClient.instances[-1]
    assert client.connected == ("ftp.example", 21)
    assert client.logged_in == ("u", "p")
    assert client.listed == "/pub"
    assert client.quit_called
    assert spy.calls == ["ftp.example"]


async def test_ftp_test_failure(monkeypatch):
    import aioftp

    monkeypatch.setattr(ftp_mod, "enforce", _EgressSpy())

    class _BadClient(_FakeFtpClient):
        async def login(self, user="anonymous", password=""):
            raise aioftp.StatusCodeError("530", "530", "login failed")

    monkeypatch.setattr(ftp_mod.aioftp, "Client", _BadClient)
    adapter = FtpAdapter({"host": "h"}, {"username": "u", "password": "bad"})
    result = await adapter.test()
    assert result["ok"] is False
    assert "FTP test failed" in result["message"]


async def test_ftps_explicit_upgrades_tls(monkeypatch):
    # test() is inherited from FtpAdapter, so it uses the ftp module's enforce.
    monkeypatch.setattr(ftp_mod, "enforce", _EgressSpy())
    monkeypatch.setattr(ftps_mod.aioftp, "Client", _FakeFtpClient)

    adapter = FtpsAdapter(
        {"host": "ftps.example", "implicit": False},
        {"username": "u", "password": "p"},
    )
    result = await adapter.test()
    assert result["ok"] is True
    client = _FakeFtpClient.instances[-1]
    assert client.upgraded is True  # AUTH TLS happened
    # explicit mode: no ssl passed to the constructor
    assert client.kwargs.get("ssl") is None


async def test_ftps_implicit_passes_ssl_context(monkeypatch):
    monkeypatch.setattr(ftp_mod, "enforce", _EgressSpy())
    monkeypatch.setattr(ftps_mod.aioftp, "Client", _FakeFtpClient)

    adapter = FtpsAdapter(
        {"host": "ftps.example", "implicit": True},
        {"username": "u", "password": "p"},
    )
    result = await adapter.test()
    assert result["ok"] is True
    client = _FakeFtpClient.instances[-1]
    assert client.upgraded is False  # implicit: no explicit AUTH TLS
    assert client.kwargs.get("ssl") is not None


# --------------------------------------------------------------------------- #
# factory
# --------------------------------------------------------------------------- #


def test_adapter_for_maps_protocols():
    creds = {"username": "u", "password": "p"}
    assert isinstance(
        adapter_for(
            {"protocol": "s3", "config": {"bucket": "b"}},
            {"access_key_id": "x", "secret_access_key": "y"},
        ),
        S3Adapter,
    )
    assert isinstance(adapter_for({"protocol": "ftp", "config": {"host": "h"}}, creds), FtpAdapter)
    assert isinstance(
        adapter_for({"protocol": "ftps", "config": {"host": "h"}}, creds), FtpsAdapter
    )

    ssh = adapter_for({"protocol": "ssh", "config": {"host": "h"}}, creds)
    assert isinstance(ssh, SftpAdapter) and ssh.protocol == "ssh"
    sftp = adapter_for({"protocol": "sftp", "config": {"host": "h"}}, creds)
    assert isinstance(sftp, SftpAdapter) and sftp.protocol == "sftp"


def test_adapter_for_stac_api_reserved():
    with pytest.raises(NotImplementedError, match="reserved for a future release"):
        adapter_for({"protocol": "stac-api", "config": {}}, {})


def test_adapter_for_unknown_protocol():
    with pytest.raises(ValueError, match="unknown connection protocol"):
        adapter_for({"protocol": "gopher", "config": {}}, {})
