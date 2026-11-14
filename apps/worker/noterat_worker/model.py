"""What the worker needs from a speech-to-text model, kept small so the tests can stand in a fake one
(and faster-whisper, which is big, is only imported by whisper.py)."""

from __future__ import annotations

from collections.abc import Iterable, Iterator
from dataclasses import dataclass
from typing import Protocol

# A pause at least this long (in seconds) between two segments starts a new paragraph.
PARAGRAPH_PAUSE = 2.0


@dataclass(frozen=True)
class Segment:
    start: float
    end: float
    text: str


@dataclass
class Transcription:
    language: str  # the job's language, or the one the model heard
    duration: float  # seconds of audio
    segments: Iterator[Segment]  # produced lazily: the work happens as they're read


class UndecodableAudio(Exception):
    """The file isn't audio that can be read; trying again won't help."""


class Model(Protocol):
    def transcribe(self, path: str, language: str | None) -> Transcription:
        """language None: detect it. Raises UndecodableAudio for a file that can't be read."""
        ...


def join_text(segments: Iterable[Segment], pause: float = PARAGRAPH_PAUSE) -> str:
    """The segments' text as one text: a space between segments, a blank line where the speaker
    paused for `pause` seconds or more, which is usually where a new thought starts."""
    parts: list[str] = []
    prev_end: float | None = None
    for seg in segments:
        text = seg.text.strip()
        if not text:
            continue
        if prev_end is not None:
            parts.append("\n\n" if seg.start - prev_end >= pause else " ")
        parts.append(text)
        prev_end = seg.end
    return "".join(parts).strip()
