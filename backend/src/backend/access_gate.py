from __future__ import annotations

import hashlib
import hmac
import time
from dataclasses import dataclass
from threading import Lock


ACCESS_COOKIE_NAME = "splitter_access"
ACCESS_SESSION_TTL_SECONDS = 30 * 24 * 60 * 60
ACCESS_MAX_ATTEMPTS = 10
ACCESS_ATTEMPT_WINDOW_SECONDS = 10 * 60


@dataclass(frozen=True, slots=True)
class AccessGateConfig:
    pin: str


def is_access_gate_enabled(config: AccessGateConfig) -> bool:
    return bool(config.pin.strip())


def _signing_key(pin: str) -> bytes:
    return hmac.new(b"splitter.access.v1", pin.encode("utf-8"), hashlib.sha256).digest()


def _sign(expires_at: int, pin: str) -> str:
    return hmac.new(_signing_key(pin), str(expires_at).encode("ascii"), hashlib.sha256).hexdigest()


def mint_session_token(config: AccessGateConfig, now: int | None = None) -> str:
    issued_at = int(time.time() if now is None else now)
    expires_at = issued_at + ACCESS_SESSION_TTL_SECONDS
    return f"{expires_at}.{_sign(expires_at, config.pin)}"


def is_valid_session_token(token: str | None, config: AccessGateConfig, now: int | None = None) -> bool:
    if not token or "." not in token:
        return False
    expires_raw, signature = token.split(".", 1)
    try:
        expires_at = int(expires_raw)
    except ValueError:
        return False
    current_time = int(time.time() if now is None else now)
    if expires_at <= current_time:
        return False
    return hmac.compare_digest(signature, _sign(expires_at, config.pin))


def is_correct_pin(candidate: object, config: AccessGateConfig) -> bool:
    if not isinstance(candidate, str) or not candidate:
        return False
    left = hmac.new(b"splitter.compare", candidate.encode("utf-8"), hashlib.sha256).digest()
    right = hmac.new(b"splitter.compare", config.pin.encode("utf-8"), hashlib.sha256).digest()
    return hmac.compare_digest(left, right)


_attempts: dict[str, tuple[int, int]] = {}
_attempt_lock = Lock()


def is_attempt_limited(client_key: str, now: int | None = None) -> bool:
    current_time = int(time.time() if now is None else now)
    with _attempt_lock:
        current = _attempts.get(client_key)
        if current is None:
            return False
        count, first_at = current
        if current_time - first_at > ACCESS_ATTEMPT_WINDOW_SECONDS:
            _attempts.pop(client_key, None)
            return False
        return count >= ACCESS_MAX_ATTEMPTS


def register_failed_attempt(client_key: str, now: int | None = None) -> int:
    current_time = int(time.time() if now is None else now)
    with _attempt_lock:
        count, first_at = _attempts.get(client_key, (0, current_time))
        if current_time - first_at > ACCESS_ATTEMPT_WINDOW_SECONDS:
            count, first_at = 0, current_time
        count += 1
        _attempts[client_key] = (count, first_at)
        return count


def clear_attempts(client_key: str) -> None:
    with _attempt_lock:
        _attempts.pop(client_key, None)


def reset_attempts_for_test() -> None:
    with _attempt_lock:
        _attempts.clear()
