from __future__ import annotations

import pytest

from noterat_worker.config import ConfigError, from_env
from noterat_worker.model import Segment, join_text


def test_segments_join_with_spaces():
    assert join_text([Segment(0, 1, " Hej "), Segment(1.2, 2, "på dig."), Segment(3.9, 5, "Hur mår du?")]) == "Hej på dig. Hur mår du?"


def test_a_pause_of_two_seconds_starts_a_paragraph():
    segments = [Segment(0, 1, "Ett."), Segment(3.0, 4, "Två."), Segment(5.99, 6, "Tre."), Segment(8.5, 9, "Fyra.")]
    assert join_text(segments) == "Ett.\n\nTvå. Tre.\n\nFyra."


def test_empty_segments_are_skipped_and_the_text_stripped():
    assert join_text([Segment(0, 1, "  "), Segment(5, 6, " Bara detta. "), Segment(6, 9, "")]) == "Bara detta."
    assert join_text([]) == ""


def test_config_from_env():
    config = from_env({"NOTERAT_URL": "http://192.168.1.10:3300/", "WORKER_TOKEN": "x" * 40})
    assert config.noterat_url == "http://192.168.1.10:3300"
    assert config.model == "KBLab/kb-whisper-large"
    assert config.device == "auto"
    assert config.compute_type is None
    assert config.models_dir == "/models"
    assert config.worker_name


@pytest.mark.parametrize(
    "env",
    [
        {"NOTERAT_URL": "http://noterat:3000"},
        {"WORKER_TOKEN": "x"},
        {"NOTERAT_URL": "noterat:3000", "WORKER_TOKEN": "x"},
        {"NOTERAT_URL": "http://[IP]:3300", "WORKER_TOKEN": "x"},  # Unraid's template default, not filled in
        {"NOTERAT_URL": "http://noterat:3000", "WORKER_TOKEN": "x", "DEVICE": "gpu"},
    ],
)
def test_config_errors(env):
    with pytest.raises(ConfigError):
        from_env(env)


def test_undecodable_files_are_told_apart(tmp_path):
    """With faster-whisper installed (it isn't in CI's test job): what PyAV can't read is UndecodableAudio."""
    pytest.importorskip("faster_whisper")
    from noterat_worker.model import UndecodableAudio
    from noterat_worker.whisper import decode

    garbage = tmp_path / "garbage"
    garbage.write_bytes(b"this is not audio at all" * 100)
    empty = tmp_path / "empty"
    empty.write_bytes(b"")
    for path in (garbage, empty):
        with pytest.raises(UndecodableAudio):
            decode(str(path))
