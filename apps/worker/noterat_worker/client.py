"""The worker's side of Noterat's worker API (docs/decisions/0006, "The worker", and 0008 for scans),
over plain urllib.

Every answer the worker has to act on differently is its own exception, so the loop can say what
happened in words: a wrong token, a job that isn't ours any more, a server that can't be reached.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import urllib.error
import urllib.request
from typing import Any
from urllib.parse import quote

from . import __version__

# The server holds POST /next open for up to 25 s when there's no work, so give it room.
NEXT_TIMEOUT = 40.0
# Everything else answers at once; for a download this is the longest wait between two reads.
TIMEOUT = 30.0
CHUNK = 1 << 20

_SHA256 = re.compile(r"^[0-9a-fA-F]{64}$")


class ApiError(Exception):
    """An answer the protocol doesn't have (a 404 from an old server, a 400, …)."""

    def __init__(self, status: int, message: str):
        super().__init__(f"HTTP {status}: {message}" if message else f"HTTP {status}")
        self.status = status


class Unauthorized(ApiError):
    """401: the token isn't the one the server has."""


class JobGone(ApiError):
    """409: the job isn't this worker's any more (taken back, or the memo or scan was deleted)."""


class NotFound(ApiError):
    """404 for a file: the server hasn't got it."""


class Unreachable(Exception):
    """The server can't be reached, or answered with a 5xx: try again later."""


class Client:
    def __init__(self, base_url: str, token: str):
        self.base = base_url.rstrip("/") + "/api/worker"
        self.headers = {
            "Authorization": f"Bearer {token}",
            "User-Agent": f"noterat-worker/{__version__}",
        }

    # ── the protocol ──

    def next_job(self, worker: str, model: str | None, kinds: tuple[str, ...] = ("transcribe",)) -> dict[str, Any] | None:
        """Waits (on the server) for a job; None when there's none (204)."""
        status, body = self._call("POST", "/next", {"worker": worker, "kinds": list(kinds), "model": model}, timeout=NEXT_TIMEOUT)
        if status == 204 or not body:
            return None
        data = json.loads(body)
        job = data.get("job") if isinstance(data, dict) else None
        if not isinstance(job, dict) or "id" not in job:
            raise ApiError(status, f"expected {{ job: {{ id, … }} }}, got {body[:200]!r}")
        return job

    def download(self, file_hash: str, dest: str) -> int:
        """Saves the file (a recording, a scan's page) to dest; checks it against its hash. Returns its size."""
        req = self._request("GET", "/files/" + quote(file_hash, safe=""), None)
        digest = hashlib.sha256()
        size = 0
        try:
            with urllib.request.urlopen(req, timeout=TIMEOUT) as res, open(dest, "wb") as out:
                while chunk := res.read(CHUNK):
                    digest.update(chunk)
                    out.write(chunk)
                    size += len(chunk)
        except urllib.error.HTTPError as e:
            raise self._error(e) from None
        except (urllib.error.URLError, OSError) as e:
            # a download cut off halfway is a network problem too
            raise Unreachable(_reason(e)) from None
        # Files are named by the SHA-256 of their bytes, so a short or mangled copy shows here.
        if _SHA256.match(file_hash) and digest.hexdigest() != file_hash.lower():
            raise Unreachable(f"the file's bytes don't match its hash ({size} bytes received)")
        return size

    def upload(self, job_id: str, path: str, content_type: str) -> dict[str, Any]:
        """Hands the server a file the job made (a cropped page, the PDF), which it keeps by hash:
        returns its { hash, size, type }. Raises JobGone (409) when the job isn't ours any more."""
        size = os.path.getsize(path)
        digest = hashlib.sha256()
        with open(path, "rb") as f:
            while chunk := f.read(CHUNK):
                digest.update(chunk)
        headers = dict(self.headers)
        headers.update({"Content-Type": content_type, "Content-Length": str(size)})
        url = f"{self.base}/jobs/{quote(str(job_id), safe='')}/files"
        try:
            with open(path, "rb") as f:
                req = urllib.request.Request(url, data=f, headers=headers, method="PUT")
                with urllib.request.urlopen(req, timeout=TIMEOUT) as res:
                    body = res.read()
        except urllib.error.HTTPError as e:
            raise self._error(e) from None
        except (urllib.error.URLError, OSError) as e:
            raise Unreachable(_reason(e)) from None
        try:
            data = json.loads(body)
        except ValueError:
            data = None
        if not isinstance(data, dict) or not isinstance(data.get("hash"), str) or not data["hash"]:
            raise ApiError(200, f"expected {{ hash, size, type }}, got {body[:200]!r}")
        # The server names the file by the SHA-256 of what it got; a different one means it didn't get
        # what was sent.
        if _SHA256.match(data["hash"]) and data["hash"].lower() != digest.hexdigest():
            raise Unreachable(f"the server got other bytes than were sent ({data.get('size')} of {size})")
        return data

    def progress(self, job_id: str, progress: float) -> None:
        """Raises JobGone (409) when the job isn't ours any more."""
        self._call("POST", f"/jobs/{quote(str(job_id), safe='')}/progress", {"progress": progress})

    def done(self, job_id: str, result: dict[str, Any]) -> None:
        self._call("POST", f"/jobs/{quote(str(job_id), safe='')}/done", result)

    def failed(self, job_id: str, error: str, retry: bool) -> None:
        self._call("POST", f"/jobs/{quote(str(job_id), safe='')}/failed", {"error": error, "retry": retry})

    # ── HTTP ──

    def _request(self, method: str, path: str, payload: Any) -> urllib.request.Request:
        headers = dict(self.headers)
        data = None
        if payload is not None:
            data = json.dumps(payload, ensure_ascii=False).encode()
            headers["Content-Type"] = "application/json"
        return urllib.request.Request(self.base + path, data=data, headers=headers, method=method)

    def _call(self, method: str, path: str, payload: Any, timeout: float = TIMEOUT) -> tuple[int, bytes]:
        req = self._request(method, path, payload)
        try:
            with urllib.request.urlopen(req, timeout=timeout) as res:
                return res.status, res.read()
        except urllib.error.HTTPError as e:
            raise self._error(e) from None
        except (urllib.error.URLError, OSError) as e:
            raise Unreachable(_reason(e)) from None

    @staticmethod
    def _error(e: urllib.error.HTTPError) -> Exception:
        try:
            text = e.read(500).decode("utf-8", "replace").strip()
        except Exception:
            text = ""
        if e.code >= 500:
            return Unreachable(f"HTTP {e.code} {text}".strip())
        kind = {401: Unauthorized, 404: NotFound, 409: JobGone}.get(e.code, ApiError)
        return kind(e.code, text)


def _reason(e: Exception) -> str:
    reason = getattr(e, "reason", None) or e
    return str(reason) or type(reason).__name__
