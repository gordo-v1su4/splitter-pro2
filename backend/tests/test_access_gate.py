from __future__ import annotations

from fastapi.testclient import TestClient

from backend.access_gate import (
    ACCESS_COOKIE_NAME,
    ACCESS_MAX_ATTEMPTS,
    ACCESS_SESSION_TTL_SECONDS,
    AccessGateConfig,
    is_correct_pin,
    is_valid_session_token,
    mint_session_token,
    reset_attempts_for_test,
)
from backend.app import create_app
from backend.config import get_settings


def test_access_token_round_trip_and_tamper_rejection() -> None:
    config = AccessGateConfig(pin="4821")
    token = mint_session_token(config, now=100)

    assert is_valid_session_token(token, config, now=101)
    assert not is_valid_session_token(token, AccessGateConfig(pin="9999"), now=101)
    assert not is_valid_session_token(token, config, now=100 + ACCESS_SESSION_TTL_SECONDS + 1)
    assert not is_valid_session_token("nonsense", config, now=101)


def test_pin_comparison_requires_the_exact_string() -> None:
    config = AccessGateConfig(pin="4821")

    assert is_correct_pin("4821", config)
    assert not is_correct_pin("4822", config)
    assert not is_correct_pin(4821, config)
    assert not is_correct_pin("", config)


def test_server_gate_locks_api_and_sets_http_only_cookie(temp_data_dir, monkeypatch) -> None:
    monkeypatch.setenv("SPLITTER_APP_ACCESS_PIN", "4821")
    get_settings.cache_clear()
    reset_attempts_for_test()

    with TestClient(create_app(), base_url="https://testserver") as client:
        status = client.get("/api/access-gate")
        assert status.json() == {"required": True, "unlocked": False}
        assert client.get("/api/projects").status_code == 401
        assert client.get("/api/health").status_code == 200

        rejected = client.post("/api/access-gate", json={"pin": "nope"})
        assert rejected.status_code == 401
        assert "4821" not in rejected.text

        accepted = client.post(
            "/api/access-gate",
            json={"pin": "4821"},
            headers={"x-forwarded-proto": "https"},
        )
        assert accepted.status_code == 200
        cookie = accepted.headers["set-cookie"]
        assert f"{ACCESS_COOKIE_NAME}=" in cookie
        assert "HttpOnly" in cookie
        assert "SameSite=strict" in cookie
        assert "Secure" in cookie
        assert client.get("/api/projects").status_code == 200

    monkeypatch.delenv("SPLITTER_APP_ACCESS_PIN")
    get_settings.cache_clear()
    reset_attempts_for_test()


def test_gate_throttles_repeated_failures(temp_data_dir, monkeypatch) -> None:
    monkeypatch.setenv("SPLITTER_APP_ACCESS_PIN", "4821")
    get_settings.cache_clear()
    reset_attempts_for_test()

    with TestClient(create_app()) as client:
        for _ in range(ACCESS_MAX_ATTEMPTS):
            assert client.post("/api/access-gate", json={"pin": "wrong"}).status_code == 401
        assert client.post("/api/access-gate", json={"pin": "wrong"}).status_code == 429

    monkeypatch.delenv("SPLITTER_APP_ACCESS_PIN")
    get_settings.cache_clear()
    reset_attempts_for_test()
