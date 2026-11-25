import hashlib, json, os, time
from pathlib import Path
import httpx

CACHE_DIR = Path(__file__).resolve().parents[2] / "data" / "http_cache"
CACHE_DIR.mkdir(parents=True, exist_ok=True)
_client = httpx.Client(timeout=15, headers={"User-Agent": "variant-copilot/0.1"})

def cached_get(url: str, params: dict | None = None, *, as_json: bool = True, pause: float = 0.0):
    key = hashlib.sha256(json.dumps([url, params or {}], sort_keys=True).encode()).hexdigest()[:16]
    path = CACHE_DIR / f"{key}.json"
    if path.exists():
        return json.loads(path.read_text())["body"]
    if os.getenv("OFFLINE") == "1":
        raise RuntimeError(f"Offline and not cached: {url}")
    time.sleep(pause)                  # only for real network calls
    r = _client.get(url, params=params)
    r.raise_for_status()               # errors are never cached
    body = r.json() if as_json else r.text
    path.write_text(json.dumps({"url": str(r.url), "body": body}, ensure_ascii=False, indent=1))
    return body