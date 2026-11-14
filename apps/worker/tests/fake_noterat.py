"""A stand-in for Noterat's worker API (docs/decisions/0006, "The worker"), on a real socket, so the
tests go through the worker's actual HTTP code."""

from __future__ import annotations

import json
import re
import threading
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any


@dataclass
class Request:
    method: str
    path: str
    headers: dict[str, str]
    body: Any


@dataclass
class FakeNoterat:
    token: str = "secret-token"
    # what POST /next answers, in turn: a job (200), None (204) or a status code; then 204s
    answers: list[Any] = field(default_factory=list)
    files: dict[str, bytes] = field(default_factory=dict)
    # status codes for progress / done / failed, in turn; then 204s
    progress_statuses: list[int] = field(default_factory=list)
    done_statuses: list[int] = field(default_factory=list)
    idle_wait: float = 0.02  # how long an empty /next is held (the real server: up to 25 s)

    def __post_init__(self) -> None:
        self.requests: list[Request] = []
        self._cond = threading.Condition()
        fake = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args: Any) -> None:
                pass

            def do_GET(self) -> None:
                fake._handle(self, "GET")

            def do_POST(self) -> None:
                fake._handle(self, "POST")

        self._server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self._server.daemon_threads = True
        self.url = f"http://127.0.0.1:{self._server.server_address[1]}"
        threading.Thread(target=self._server.serve_forever, daemon=True).start()

    def close(self) -> None:
        self._server.shutdown()
        self._server.server_close()

    # ── what the tests look at ──

    def paths(self) -> list[str]:
        with self._cond:
            return [f"{r.method} {r.path}" for r in self.requests]

    def find(self, suffix: str) -> list[Request]:
        with self._cond:
            return [r for r in self.requests if r.path.endswith(suffix)]

    def wait_for(self, check: Callable[[list[Request]], bool], timeout: float = 5.0) -> None:
        with self._cond:
            if not self._cond.wait_for(lambda: check(self.requests), timeout):
                raise AssertionError(f"timed out; requests so far: {[f'{r.method} {r.path}' for r in self.requests]}")

    # ── the API ──

    def _handle(self, h: BaseHTTPRequestHandler, method: str) -> None:
        length = int(h.headers.get("Content-Length") or 0)
        raw = h.rfile.read(length) if length else b""
        body = json.loads(raw) if raw else None
        with self._cond:
            self.requests.append(Request(method, h.path, dict(h.headers.items()), body))
            self._cond.notify_all()

        if h.headers.get("Authorization") != f"Bearer {self.token}":
            return self._send(h, 401, {"error": "unauthorized"})

        path = h.path
        if method == "POST" and path == "/api/worker/next":
            answer = self.answers.pop(0) if self.answers else None
            if answer is None:
                time.sleep(self.idle_wait)
                return self._send(h, 204)
            if isinstance(answer, int):
                return self._send(h, answer, {"error": "test"})
            return self._send(h, 200, {"job": answer})
        if m := re.fullmatch(r"/api/worker/files/([^/]+)", path):
            data = self.files.get(m.group(1))
            if method != "GET" or data is None:
                return self._send(h, 404, {"error": "not_found"})
            h.send_response(200)
            h.send_header("Content-Type", "audio/webm")
            h.send_header("Content-Length", str(len(data)))
            h.end_headers()
            h.wfile.write(data)
            return
        if method == "POST" and (m := re.fullmatch(r"/api/worker/jobs/([^/]+)/(progress|done|failed)", path)):
            queue = {"progress": self.progress_statuses, "done": self.done_statuses}.get(m.group(2), [])
            status = queue.pop(0) if queue else 204
            return self._send(h, status, None if status == 204 else {"error": "test"})
        self._send(h, 404, {"error": "no_route"})

    @staticmethod
    def _send(h: BaseHTTPRequestHandler, status: int, payload: Any = None) -> None:
        data = b"" if payload is None or status == 204 else json.dumps(payload).encode()
        h.send_response(status)
        if data:
            h.send_header("Content-Type", "application/json")
        h.send_header("Content-Length", str(len(data)))
        h.end_headers()
        if data:
            h.wfile.write(data)
