# noterat-worker

Speech to text for Noterat's voice memos. It's a small Python program around
[faster-whisper](https://github.com/SYSTRAN/faster-whisper) and
[KB-Whisper](https://huggingface.co/KBLab/kb-whisper-large), the National Library of Sweden's
Whisper trained on Swedish. It runs in its own container, on an Nvidia GPU if there is one.

The worker never sees Noterat's database. It asks Noterat for work over HTTP (`POST /api/worker/next`,
a long poll), fetches the recording, transcribes it, reports progress while it works and sends the
text back. Each request carries `Authorization: Bearer <WORKER_TOKEN>`. The protocol is described in
[docs/decisions/0006](../../docs/decisions/0006-notes-files-and-the-worker.md#the-worker). The model
is loaded once at start, and downloaded into `/models` the first time.

How it behaves:

- **The text.** Segment texts are joined with spaces. A pause of 2 s or more starts a new
  paragraph (a blank line). It transcribes the way KBLab's model card does
  (`condition_on_previous_text=False`, which helps against made-up repeats), and the VAD filter skips
  silence. If the job's language is null, the model works it out.
- **Progress.** Sent at most every 5 s. A `409` stops the job: it's been taken back, or the memo
  was deleted.
- **Failures.** If transcription fails, it posts `failed` with `retry: true`. The exception is a
  file PyAV can't read, or one with no sound in it; that gets `retry: false`.
- **When Noterat can't be reached.** It tries again after 1 s, then 2 s, doubling up to 30 s, and
  never crashes. A finished transcript is delivered for up to 10 minutes of trying.
- **A wrong token** (`401`). It says so in the log and asks again every 60 s.
- **`docker stop`** (SIGTERM). If it's only waiting, it exits at once. If it's in the middle of a
  job, it gives the job back (`failed`, `retry: true`) so the job is queued again right away.
- **The log.** One line per job: id, seconds of audio, seconds it took, language and characters.

## Settings

| Variable | Default | |
|---|---|---|
| `NOTERAT_URL` | (required) | Noterat as the worker reaches it, e.g. `http://192.168.1.10:3300`, or `http://noterat:3000` in compose |
| `WORKER_TOKEN` | (required) | The same long random string as `WORKER_TOKEN` on Noterat (`openssl rand -hex 32`) |
| `MODEL` | `KBLab/kb-whisper-large` | A Hugging Face id of a Whisper in CTranslate2's format, or a folder with a `model.bin`. KB-Whisper also comes as `-medium`, `-small`, `-base` and `-tiny` |
| `DEVICE` | `auto` | `cuda`, `cpu`, or `auto` (the GPU if CTranslate2 sees one) |
| `COMPUTE_TYPE` | `float16` on a GPU, `int8` on a CPU | Anything [CTranslate2 takes](https://opennmt.net/CTranslate2/quantization.html), e.g. `int8_float16` for less GPU memory |
| `MODELS_DIR` | `/models` | Where models are downloaded to |
| `WORKER_NAME` | the hostname | How the worker introduces itself to Noterat |
| `LOG_LEVEL` | `INFO` | `DEBUG` also shows each request of the download and each retry |
| `PUID` / `PGID` / `UMASK` | `99` / `100` / `002` | Who owns what it writes in `/models` (in the image) |

`kb-whisper-large` takes about 3 GB on disk and about 4 GB of GPU memory in float16.

## Running it

### Unraid

1. Install the **Nvidia Driver** plugin from Community Applications. Then reboot.
2. Set `WORKER_TOKEN` on Noterat's container (a long random string).
3. Add the container from [`unraid/noterat-worker.xml`](../../unraid/noterat-worker.xml). The
   template sets `--runtime=nvidia`, `NVIDIA_VISIBLE_DEVICES=all` and
   `NVIDIA_DRIVER_CAPABILITIES=compute,utility`. Fill in Noterat's address
   (`http://<server IP>:3300`) and the same worker token.

The first start downloads the model into `/mnt/user/appdata/noterat-worker/models`. The log then
says `… is ready on cuda (float16)`, followed by `asking http://… for work`.

### Docker Compose

Next to Noterat, with the [NVIDIA Container Toolkit](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/latest/install-guide.html)
installed, put `WORKER_TOKEN=…` in `.env`, then:

```sh
docker compose --profile gpu up -d
```

### docker run

```sh
docker run -d --name noterat-worker --restart unless-stopped --gpus all \
  -e NOTERAT_URL=http://192.168.1.10:3300 -e WORKER_TOKEN=… \
  -v noterat-models:/models ghcr.io/svennefenne/noterat-worker:latest
```

`--runtime=nvidia -e NVIDIA_VISIBLE_DEVICES=all` does the same as `--gpus all`. Without a GPU, use
`DEVICE=cpu`. It works, but slower: `kb-whisper-large` took 7 times as long on a desktop CPU as on
an RTX 3070 Ti. A smaller model helps.

### What's in the image

The base is `python:3.12-slim` with faster-whisper 1.2.1. It has no CUDA base image: the driver
comes from the host, through the Nvidia runtime, and the one CUDA library CTranslate2 4.9 loads,
cuBLAS 12, comes from pip (`nvidia-cublas-cu12`, found through `LD_LIBRARY_PATH`). CTranslate2 4.9
runs Whisper's convolutions on cuBLAS, so cuDNN isn't needed. FFmpeg comes inside PyAV's wheel. The
image is about 2.6 GB unpacked (890 MB to download), most of it cuBLAS.

Two pins matter. `av==18.1.0`, because faster-whisper 1.2.1 calls `av.open(metadata_errors=…)`,
which PyAV 19 removed. `ctranslate2==4.9.0`, because the no-cuDNN point above depends on it.

## Trying it

`--file` transcribes one file and prints the result as JSON (text, segments and timings), without a
server. It's the quickest way to see that the model and the GPU work:

```sh
docker run --rm --gpus all -v noterat-models:/models -v "$PWD":/audio:ro \
  ghcr.io/svennefenne/noterat-worker:latest python -m noterat_worker --file /audio/memo.webm --language sv
```

Without Docker, in a Python 3.12 venv (the image's Python):

```sh
cd apps/worker
python3.12 -m venv /tmp/nw && /tmp/nw/bin/pip install -e '.[cuda,test]'
export LD_LIBRARY_PATH=$(/tmp/nw/bin/python -c 'import nvidia.cublas, os; print(os.path.join(nvidia.cublas.__path__[0], "lib"))')
MODELS_DIR=/tmp/models MODEL=KBLab/kb-whisper-small DEVICE=cpu /tmp/nw/bin/python -m noterat_worker --file memo.webm
MODELS_DIR=/tmp/models /tmp/nw/bin/python -m noterat_worker --file memo.webm   # large, on the GPU
```

You can make a Swedish test clip with [Piper](https://github.com/OHF-Voice/piper1-gpl) and the
`sv_SE-nst-medium` voice. Recode it to WebM/Opus, which is what browsers record:

```sh
python3.12 -m venv /tmp/piper && /tmp/piper/bin/pip install piper-tts
for f in sv_SE-nst-medium.onnx sv_SE-nst-medium.onnx.json; do
  curl -sSfLO "https://huggingface.co/rhasspy/piper-voices/resolve/main/sv/sv_SE/nst/medium/$f"
done
echo "Hej, det här är ett röstmemo till Noterat. Kom ihåg att köpa mjölk, bröd och kaffe på vägen hem från jobbet." \
  | /tmp/piper/bin/piper -m sv_SE-nst-medium.onnx -f part1.wav
echo "Och glöm inte att ringa mormor på söndag, hon fyller åttio år." | /tmp/piper/bin/piper -m sv_SE-nst-medium.onnx -f part2.wav
ffmpeg -i part1.wav -f lavfi -t 3 -i anullsrc=r=22050:cl=mono -i part2.wav \
  -filter_complex "[0:a][1:a][2:a]concat=n=3:v=0:a=1" -c:a libopus -b:a 32k memo.webm
```

Here is how that 15.3-second clip went on a desktop with an RTX 3070 Ti, with the model already
downloaded:

| Model | Device | Load | Transcribe |
|---|---|---|---|
| kb-whisper-large | cuda, float16 | 1.9 s | 0.9–1.2 s |
| kb-whisper-large | cpu, int8 | 5.1 s | 7.2 s |
| kb-whisper-small | cuda, float16 | 1.0 s | 0.4 s |
| kb-whisper-small | cpu, int8 | 1.1 s | 1.5 s |

Large gave this, with the 3-second pause as a new paragraph:

> Hej! Det här är ett röstmemo till noterat. Kom ihåg att köpa mjölk, bröd och kaffe på vägen hem
> från jobbet.
>
> Och glöm inte att ringa mormor på söndag. Hon fyller 80 år.

## Tests

```sh
cd apps/worker
pip install pytest     # the tests use a fake model: no faster-whisper needed
python -m pytest
```

They run the real loop and HTTP client against a fake Noterat (`tests/fake_noterat.py`, a
`http.server` in a thread). They cover:

- a job going through next → file → progress → done
- 204s followed by a job
- failed with and without retry
- a 409 on progress
- a wrong token
- back-off while the server is down
- a done that has to be sent again
- stopping in the middle of a job
- SIGTERM cutting a long poll short

CI (`.github/workflows/worker.yml`) runs them, then builds `ghcr.io/svennefenne/noterat-worker`.
