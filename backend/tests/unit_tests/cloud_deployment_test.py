import pytest

from cloud_preflight import validate_environment


def test_cloud_configuration_accepts_remote_database():
    assert validate_environment(
        {
            "ENVIRONMENT": "PRODUCTION",
            "PG_DSN": "postgresql://user:pass@db.internal/db",
            "JWT_SECRET": "x" * 64,
        }
    ) == [1, 8]


@pytest.mark.parametrize("host", ["localhost", "127.0.0.1", "::1", "old.trycloudflare.com"])
def test_cloud_configuration_rejects_local_or_tunnel_database(host):
    if host == "::1":
        host = "[::1]"
    with pytest.raises(ValueError, match="managed PostgreSQL"):
        validate_environment(
            {
                "ENVIRONMENT": "PRODUCTION",
                "PG_DSN": f"postgresql://user:pass@{host}/db",
                "JWT_SECRET": "x" * 64,
            }
        )


def test_cloud_configuration_rejects_weak_jwt():
    with pytest.raises(ValueError, match="JWT secret"):
        validate_environment(
            {
                "ENVIRONMENT": "PRODUCTION",
                "PG_DSN": "postgresql://user:pass@db.internal/db",
                "JWT_SECRET": "short",
            }
        )
