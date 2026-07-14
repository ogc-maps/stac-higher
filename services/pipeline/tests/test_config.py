"""Settings env contract."""

from pipeline.config import (
    DEFAULT_DATABASE_URL,
    DEFAULT_HEALTH_PORT,
    DEFAULT_QUEUE_SCHEMA,
    Settings,
)


def test_defaults():
    settings = Settings.from_env(env={})
    assert settings.database_url == DEFAULT_DATABASE_URL
    assert settings.database_url == "postgresql://username:password@localhost:5433/postgis"
    assert settings.health_port == DEFAULT_HEALTH_PORT == 8083
    assert settings.queue_schema == DEFAULT_QUEUE_SCHEMA == "procrastinate"
    assert settings.log_level == "INFO"


def test_env_overrides():
    settings = Settings.from_env(
        env={
            "DATABASE_URL": "postgresql://username:password@database:5432/postgis",
            "HEALTH_PORT": "9999",
            "QUEUE_SCHEMA": "queue",
            "LOG_LEVEL": "debug",
        }
    )
    assert settings.database_url == "postgresql://username:password@database:5432/postgis"
    assert settings.health_port == 9999
    assert settings.queue_schema == "queue"
    assert settings.log_level == "DEBUG"
