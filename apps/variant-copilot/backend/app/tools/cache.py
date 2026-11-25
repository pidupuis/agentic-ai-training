"""HTTP GET with an on-disk cache, shared by the Ensembl and PubMed tools.

Why a cache: the same variant is analysed many times while developing; replaying a
saved response is free, instant and works offline (OFFLINE=1 forbids the network).
Errors are never cached, so a failed call is retried next time.

Rate limiting: `pause` is a minimum delay between two real calls, enforced for the
whole process (all threads), because the UI can analyse several variants at once and
NCBI allows only 3 requests per second without an API key.
"""

import hashlib
import json
import os
import tempfile
import threading
import time
from pathlib import Path

import httpx

CACHE_DIR = Path(__file__).resolve().parents[2] / "data" / "http_cache"
MAX_ATTEMPTS = 3  # first try + 2 retries on HTTP 429 (Too Many Requests)

_client = httpx.Client(timeout=15, headers={"User-Agent": "variant-copilot/0.1"})

# Shared by every thread: time of the last real call made with a pause.
_rate_lock = threading.Lock()
_last_call = 0.0


def cached_get(url: str, params: dict | None = None, *, as_json: bool = True, pause: float = 0.0):
    """GET `url` with `params`, from the cache if this exact request was already made.

    Args:
        url: endpoint, without query string.
        params: query parameters; part of the cache key.
        as_json: decode the body as JSON (default) or return it as text.
        pause: minimum seconds between two real calls, across all threads.

    Returns:
        The response body (dict/list if as_json, else str).

    Raises:
        RuntimeError if OFFLINE=1 and the request is not cached;
        httpx.HTTPError on network or HTTP errors (still 429 after MAX_ATTEMPTS).
    """
    key = hashlib.sha256(json.dumps([url, params or {}], sort_keys=True).encode()).hexdigest()[:16]
    path = CACHE_DIR / f"{key}.json"
    try:
        return json.loads(path.read_text())["body"]
    except (FileNotFoundError, json.JSONDecodeError, KeyError):
        pass  # not cached, or a damaged file: fetch again (and overwrite it)
    if os.getenv("OFFLINE") == "1":
        raise RuntimeError(f"Offline and not cached: {url}")

    r = _get_with_retry(url, params, pause)
    body = r.json() if as_json else r.text
    _write_atomic(path, {"url": str(r.url), "body": body})
    return body


def _get_with_retry(url: str, params: dict | None, pause: float) -> httpx.Response:
    """Real network call, rate-limited, retried when the server answers 429."""
    for attempt in range(1, MAX_ATTEMPTS + 1):
        _wait_turn(pause)
        r = _client.get(url, params=params)
        if r.status_code != 429 or attempt == MAX_ATTEMPTS:
            r.raise_for_status()  # errors are never cached
            return r
        # Retry-After is in seconds when present; otherwise back off 1 s, then 2 s.
        retry_after = r.headers.get("Retry-After", "")
        time.sleep(float(retry_after) if retry_after.isdigit() else attempt)
    raise AssertionError("unreachable")


def _wait_turn(pause: float) -> None:
    """Sleep until at least `pause` seconds have passed since the previous paused call."""
    global _last_call
    if pause <= 0:
        return
    # The lock makes threads take turns: each one reserves its time slot, then calls.
    with _rate_lock:
        delay = _last_call + pause - time.monotonic()
        if delay > 0:
            time.sleep(delay)
        _last_call = time.monotonic()


def _write_atomic(path: Path, content: dict) -> None:
    """Write to a unique temporary file, then rename: readers never see a half-written file."""
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=path.parent, suffix=".tmp")
    try:
        with os.fdopen(fd, "w") as f:
            json.dump(content, f, ensure_ascii=False, indent=1)
        os.replace(tmp, path)  # atomic on the same file system
    except BaseException:
        os.unlink(tmp)
        raise
