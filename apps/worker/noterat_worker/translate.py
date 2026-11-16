"""Translating a recipe's text (docs/decisions/0009): opus-mt's English to Swedish (Helsinki-NLP, trained
on OPUS's open texts), through CTranslate2 as Whisper is. It's small (75 MB) and quick (a recipe in a
fraction of a second on the CPU), so it runs there and leaves the GPU to Whisper.

The server sends the pieces to translate (core's recipeTranslate.ts picks them out: what its glossary
hasn't got, sentence by sentence) and puts the translations in their places itself; the worker only
translates. The model is downloaded into the models folder the first time, like Whisper.
"""

from __future__ import annotations

import logging
import os
from typing import Protocol

log = logging.getLogger("noterat_worker")

# Helsinki-NLP/opus-mt-en-sv, converted for CTranslate2 (int8): a revision of its own, so what's
# downloaded is what was tried
MODEL = "DigitalTolk/opus-mt-en-sv-ctranslate2-int"
REVISION = "b166d7f87fc586ae40e346a7df5c90d946d02d3c"
FILES = ["config.json", "model.bin", "shared_vocabulary.json", "source.spm", "target.spm"]
PAIRS = {("en", "sv")}
# (a piece longer than this, in the model's tokens, is cut: the method's sentences are far shorter)
MAX_TOKENS = 400


class TranslatorUnavailable(Exception):
    """The model can't be had or loaded here; the message says why."""


class UnknownPair(Exception):
    """The job asks for languages the model doesn't translate between; trying again won't help."""


class Translator(Protocol):
    name: str

    def translate(self, texts: list[str], source: str, target: str) -> list[str]:
        """Each text translated, in order. Raises UnknownPair for languages it doesn't do."""
        ...


class OpusMt:
    name = "opus-mt-en-sv"

    def __init__(self, models_dir: str, threads: int = 4):
        try:
            import ctranslate2
            import sentencepiece
            from huggingface_hub import snapshot_download
        except ImportError as e:
            raise TranslatorUnavailable(f"{e.name or e} isn't installed (pip install '.[translate]', or use the image)") from e
        try:
            path = snapshot_download(MODEL, revision=REVISION, cache_dir=models_dir, allow_patterns=FILES)
        except Exception as e:  # no internet: what was downloaded before will do
            try:
                path = snapshot_download(MODEL, revision=REVISION, cache_dir=models_dir, allow_patterns=FILES, local_files_only=True)
            except Exception:
                raise TranslatorUnavailable(f"couldn't download {MODEL} ({type(e).__name__}: {e})") from e
        try:
            self._model = ctranslate2.Translator(path, device="cpu", compute_type="int8", intra_threads=threads)
            self._source = sentencepiece.SentencePieceProcessor(model_file=os.path.join(path, "source.spm"))
            self._target = sentencepiece.SentencePieceProcessor(model_file=os.path.join(path, "target.spm"))
        except Exception as e:
            raise TranslatorUnavailable(f"couldn't load {MODEL} ({type(e).__name__}: {e})") from e

    def translate(self, texts: list[str], source: str, target: str) -> list[str]:
        if (source, target) not in PAIRS:
            raise UnknownPair(f"the worker translates {', '.join(f'{a} to {b}' for a, b in sorted(PAIRS))}, not {source} to {target}")
        if not texts:
            return []
        tokens = [self._source.encode(t, out_type=str)[:MAX_TOKENS] + ["</s>"] for t in texts]
        results = self._model.translate_batch(tokens, beam_size=5, max_batch_size=32, max_decoding_length=MAX_TOKENS)
        return [self._target.decode(r.hypotheses[0]) for r in results]

    def warm_up(self) -> None:
        """A sentence, to see that it all works (and have it loaded before the first job)."""
        out = self.translate(["Stir the soup."], "en", "sv")
        if not out or not out[0].strip():
            raise TranslatorUnavailable("the model translated a sentence to nothing")
