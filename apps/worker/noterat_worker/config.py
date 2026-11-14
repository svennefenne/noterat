"""Settings, all from the environment (the container's variables)."""

from __future__ import annotations

import os
import socket
from dataclasses import dataclass

DEFAULT_MODEL = "KBLab/kb-whisper-large"


class ConfigError(Exception):
    """A setting is missing or wrong; the message says which and what to do."""


@dataclass(frozen=True)
class Config:
    noterat_url: str
    token: str
    model: str = DEFAULT_MODEL
    device: str = "auto"  # auto | cuda | cpu
    compute_type: str | None = None  # None: float16 on a GPU, int8 on a CPU
    models_dir: str = "/models"
    worker_name: str = "noterat-worker"


def from_env(env: dict[str, str] | None = None, *, need_server: bool = True) -> Config:
    env = dict(os.environ if env is None else env)

    def get(name: str, default: str = "") -> str:
        return env.get(name, "").strip() or default

    url = get("NOTERAT_URL").rstrip("/")
    token = get("WORKER_TOKEN")
    if need_server:
        if not url:
            raise ConfigError("NOTERAT_URL isn't set: Noterat's address as the worker reaches it, e.g. http://192.168.1.10:3300")
        if not url.startswith(("http://", "https://")):
            raise ConfigError(f"NOTERAT_URL should start with http:// or https:// (it is {url!r})")
        if "[IP]" in url:
            raise ConfigError(f"NOTERAT_URL still says [IP] ({url}): put in the server's address, e.g. http://192.168.1.10:3300")
        if not token:
            raise ConfigError("WORKER_TOKEN isn't set: it has to be the same long random string as WORKER_TOKEN on Noterat")

    device = get("DEVICE", "auto").lower()
    if device not in ("auto", "cuda", "cpu"):
        raise ConfigError(f"DEVICE should be auto, cuda or cpu (it is {device!r})")

    return Config(
        noterat_url=url,
        token=token,
        model=get("MODEL", DEFAULT_MODEL),
        device=device,
        compute_type=get("COMPUTE_TYPE") or None,
        models_dir=get("MODELS_DIR", "/models"),
        worker_name=get("WORKER_NAME") or socket.gethostname() or "noterat-worker",
    )
