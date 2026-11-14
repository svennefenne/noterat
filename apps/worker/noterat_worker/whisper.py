"""KB-Whisper (or any Whisper in CTranslate2's format) through faster-whisper."""

from __future__ import annotations

import logging
import time

from .config import Config
from .model import Segment, Transcription, UndecodableAudio

log = logging.getLogger("noterat_worker")

SAMPLE_RATE = 16000

# KBLab's model card transcribes with condition_on_previous_text=False: without a prompt to carry
# over, it makes the model less likely to repeat itself or make things up after a silence. The VAD
# filter skips the parts without speech (and its default, a 2 s silence, matches our paragraphs).
TRANSCRIBE_OPTIONS = {"beam_size": 5, "vad_filter": True, "condition_on_previous_text": False}


class Whisper:
    def __init__(self, config: Config):
        import ctranslate2
        from faster_whisper import WhisperModel

        device = config.device
        if device == "auto":
            device = "cuda" if ctranslate2.get_cuda_device_count() > 0 else "cpu"
        compute_type = config.compute_type or ("float16" if device == "cuda" else "int8")
        self.name = config.model
        self.device = device
        self.compute_type = compute_type

        started = time.monotonic()
        log.info("loading %s on %s (%s); the first time, it's downloaded into %s", config.model, device, compute_type, config.models_dir)
        # A Hugging Face id is downloaded (only the files faster-whisper needs) into the models folder
        # and found there after that; a path to a folder with a model.bin is used as it is.
        self.model = WhisperModel(config.model, device=device, compute_type=compute_type, download_root=config.models_dir)
        # Run the encoder once on a second of silence, so a GPU that can't be used (no driver in the
        # container, a CUDA library missing) shows now rather than in the first memo.
        from faster_whisper.audio import pad_or_trim

        self.model.encode(pad_or_trim(self.model.feature_extractor(_silence(1.0))))
        log.info("%s is ready on %s (%s), in %.1f s", config.model, device, compute_type, time.monotonic() - started)

    def transcribe(self, path: str, language: str | None) -> Transcription:
        audio = decode(path)
        segments, info = self.model.transcribe(audio, language=language, **TRANSCRIBE_OPTIONS)
        return Transcription(
            language=info.language,
            duration=info.duration,
            segments=(Segment(s.start, s.end, s.text) for s in segments),
        )


def decode(path: str):
    """The recording as 16 kHz mono samples. PyAV (FFmpeg) reads whatever the browser recorded:
    WebM/Opus, Ogg, MP4/AAC, MP3, WAV…"""
    import av
    from faster_whisper import decode_audio

    try:
        audio = decode_audio(path, sampling_rate=SAMPLE_RATE)
    except av.error.FFmpegError as e:
        raise UndecodableAudio(f"the recording can't be read as audio ({e.strerror or e})") from e
    except IndexError as e:  # decode(audio=0) on a file without an audio stream
        raise UndecodableAudio("the file has no sound in it") from e
    if len(audio) == 0:
        raise UndecodableAudio("the recording is empty")
    return audio


def _silence(seconds: float):
    import numpy as np

    return np.zeros(int(seconds * SAMPLE_RATE), dtype=np.float32)
