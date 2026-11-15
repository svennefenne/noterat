# noterat-worker

Noterat's worker does three kinds of job:

- **Speech to text** for voice memos, with [faster-whisper](https://github.com/SYSTRAN/faster-whisper)
  and [KB-Whisper](https://huggingface.co/KBLab/kb-whisper-large), the National Library of Sweden's
  Whisper trained on Swedish, on an Nvidia GPU if there is one.
- **Reading scans** (documents and receipts): it finds the page in a photo and straightens it
  ([OpenCV](https://opencv.org/)), reads it in Swedish and English with
  [Tesseract](https://github.com/tesseract-ocr/tesseract) through
  [OCRmyPDF](https://github.com/ocrmypdf/OCRmyPDF), and makes a searchable PDF of the pages. This runs
  on the CPU.
- **Reading recipes** out of web pages, with
  [recipe-scrapers](https://github.com/hhursev/recipe-scrapers), for a page the server fetched but
  couldn't find a recipe in by itself. It takes a fraction of a second on the CPU.

It's a small Python program that runs in its own container. It never sees Noterat's database. It
asks Noterat for work over HTTP (`POST /api/worker/next`, a long poll), fetches the job's files, does
the job, reports progress while it works and sends the result back. Each request carries
`Authorization: Bearer <WORKER_TOKEN>`. The protocol is described in
[docs/decisions/0006](../../docs/decisions/0006-notes-files-and-the-worker.md#the-worker), for
scans in [docs/decisions/0008](../../docs/decisions/0008-scanning-and-ocr.md#the-workers-protocol-for-scans),
and why recipes are read where they are in [docs/decisions/0009](../../docs/decisions/0009-recipes.md).
`WORKER_KINDS` says which kinds of job it asks for. The Whisper model is only loaded if it
transcribes: once at start, downloaded into `/models` the first time.

How it transcribes:

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

How it reads a scan (an `ocr` job: `{ id, kind: "ocr", files, language, crop }`):

- **Fetching.** Each page is downloaded and checked against its SHA-256, as a recording is.
- **Cropping.** For each page with `crop: true` (a photo taken on the website), it looks for the
  page in the photo, upright as its EXIF says. It looks on a 1000-pixel copy, two ways: the page's
  outline (Canny edges) and the paper being lighter than the table (Otsu's threshold). It takes the
  largest four-cornered shape that covers 10–98 % of the photo, has corners of 45–135°, isn't cut
  off by the edge of the photo, and isn't longer than 9:1. That page is warped straight on, from the
  full photo, and saved as a JPEG (quality 90). When there's no clear page, the photo is read as it
  is and keeps its hash. It's conservative on purpose: a photo left alone is better than a receipt
  with its total cut off.
- **Reading.** All pages go into one PDF at 300 pixels per inch (a phone says 72, which would make a
  page a metre tall), and OCRmyPDF reads it with Tesseract (`swe+eng`, or the job's language) into a
  searchable PDF, with each page's text in a sidecar. Tesseract's page segmentation is 6 (one block of
  text), which keeps a receipt's item and price on one line and copes with a slanted photo. Pages
  photographed sideways are turned (`--rotate-pages`). Why these settings, and what was left out,
  is in `noterat_worker/ocr.py`.
- **Handing back.** Only once the reading is done does it upload the new files with
  `PUT /api/worker/jobs/:id/files`: each cropped page (`image/jpeg`), then the PDF
  (`application/pdf`). The server answers each with its hash. Then it posts `done` with
  `{ text, language, pages: [{ hash, text, cropped, width, height }], pdf: { hash }, model }`.
  `pages` are in the job's order, with the new hash (and size) of a page that was cropped. `text` is
  the pages' texts with a blank line between them. `model` is e.g. `tesseract 5.5.0`.
- **Progress.** Reported after each page is fetched and prepared (up to 0.3), and after the reading
  (0.9). A `409` on progress or on an upload stops the job.
- **Failures.** A file that isn't an image gets `failed` with `retry: false` (`page 2: the file isn't
  an image that can be read`). So does a language Tesseract hasn't got. If OCRmyPDF or Tesseract
  fails, it's `retry: true`. OCRmyPDF runs as a process of its own, so a crash doesn't take the
  worker down, and `docker stop` ends it and gives the job back.
- **At start.** It checks that Tesseract and OCRmyPDF work by reading a blank page. If they don't,
  it says why and goes on transcribing only. If it was only to read scans, it stops.
- **The log.** One line per job: id, pages (and how many were cropped), seconds, language and
  characters.

How it reads a recipe (a `recipe` job: `{ id, kind: "recipe", files: [{ hash, type: "text/html", size }], url }`):

- **Only what it's given.** The server fetched the page (only from public addresses, decision 9) and
  hands over its HTML as a file. The worker downloads it with `GET /api/worker/files/:hash`, checked
  against its SHA-256 as any file is. It **never fetches anything itself**, not the `url` and not
  the page's picture: the `url` only tells recipe-scrapers which site the page is from.
- **The text.** The page is read in the encoding its byte order mark says, else the `charset` on the
  file's type if there is one, else its `<meta charset>` (or `<meta http-equiv>`, or an XHTML page's
  `<?xml encoding>`), else UTF-8, with anything that isn't valid replaced. ISO-8859-1 is read as
  Windows-1252, as browsers do. Bytes that are valid UTF-8 are read as UTF-8 whatever the `<meta>`
  says, because the server keeps the page as UTF-8 text while its `<meta>` still names what it was
  fetched in.
- **Reading.** `scrape_html(html, org_url=url, supported_only=False)`: for a site recipe-scrapers
  knows (some 600, `arla.se`, `ica.se`, `koket.se` and `recept.se` among them) its own scraper,
  otherwise the page's schema.org `Recipe` as JSON-LD or microdata. Each field is read on its own, so
  one the page hasn't got doesn't lose the others.
- **What's sent.** `done` with `{ recipe: { title, ingredients, steps, servings, minutes, image,
  description } }`: `ingredients` and `steps` are lists of strings (steps from
  `instructions_list()`), whitespace made single spaces, empty ones left out, at most 200 of each, a
  line at most 500 characters (a longer step is split between its sentences rather than cut). `title`
  is at most 200 characters, `description` 1000; `servings` is the first number of what the page says
  (`4 portioner` → 4, `4-6 portioner` → 4), `minutes` the total time, `image` an absolute http(s)
  URL; each is `null` when the page hasn't got it.
- **Failures.** No title and no ingredients: `failed` with `no recipe was found on the page` and
  `retry: false`. So does a file that isn't a page (empty, or binary). If recipe-scrapers itself
  breaks on the page, it's `retry: true`. There's no progress (it's quick); a `409` on `done` is
  logged and that's that.
- **At start.** It reads a small recipe to see that recipe-scrapers works. Without it (the `recipe`
  extra isn't installed), it says so and goes on with the other kinds; if it was only to read
  recipes, it stops.
- **The log.** One line per job: id, title, seconds, what read it (the site's scraper or
  `schema.org`), the encoding, and how many ingredients and steps.

## Settings

| Variable | Default | |
|---|---|---|
| `NOTERAT_URL` | (required) | Noterat as the worker reaches it, e.g. `http://192.168.1.10:3300`, or `http://noterat:3000` in compose |
| `WORKER_TOKEN` | (required) | The same long random string as `WORKER_TOKEN` on Noterat (`openssl rand -hex 32`) |
| `WORKER_KINDS` | `transcribe,ocr,recipe` | The kinds of job it asks for: one or more of `transcribe`, `ocr` and `recipe`. Without `transcribe` it needs no GPU and doesn't load Whisper |
| `MODEL` | `KBLab/kb-whisper-large` | A Hugging Face id of a Whisper in CTranslate2's format, or a folder with a `model.bin`. KB-Whisper also comes as `-medium`, `-small`, `-base` and `-tiny` |
| `DEVICE` | `auto` | `cuda`, `cpu`, or `auto` (the GPU if CTranslate2 sees one) |
| `COMPUTE_TYPE` | `float16` on a GPU, `int8` on a CPU | Anything [CTranslate2 takes](https://opennmt.net/CTranslate2/quantization.html), e.g. `int8_float16` for less GPU memory |
| `MODELS_DIR` | `/models` | Where models are downloaded to |
| `WORKER_NAME` | the hostname | How the worker introduces itself to Noterat |
| `LOG_LEVEL` | `INFO` | `DEBUG` also shows each request of the download and each retry |
| `PUID` / `PGID` / `UMASK` | `99` / `100` / `002` | Who owns what it writes in `/models` (in the image) |

`kb-whisper-large` takes about 3 GB on disk and about 4 GB of GPU memory in float16. Reading a scan
takes no GPU, and no setting: the languages come with each job (`swe+eng`). Nor does reading a recipe.

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

A worker that only reads scans and recipes needs no GPU and no `/models`:

```sh
docker run -d --name noterat-scans --restart unless-stopped \
  -e NOTERAT_URL=http://192.168.1.10:3300 -e WORKER_TOKEN=… -e WORKER_KINDS=ocr,recipe \
  ghcr.io/svennefenne/noterat-worker:latest
```

### What's in the image

The base is `python:3.12-slim` with faster-whisper 1.2.1. It has no CUDA base image: the driver
comes from the host, through the Nvidia runtime, and the one CUDA library CTranslate2 4.9 loads,
cuBLAS 12, comes from pip (`nvidia-cublas-cu12`, found through `LD_LIBRARY_PATH`). CTranslate2 4.9
runs Whisper's convolutions on cuBLAS, so cuDNN isn't needed. FFmpeg comes inside PyAV's wheel.

For scans it has Debian's Tesseract 5.5 with `tesseract-ocr-swe` and `tesseract-ocr-eng` (and
`osd`, which tells which way up a page is), and the `ocr` extra from pip: OCRmyPDF 17,
`opencv-python-headless`, img2pdf and Pillow. OCRmyPDF 17 rasterizes with pypdfium2 and writes a
plain PDF itself, so neither Ghostscript nor unpaper is needed.

For recipes it has the `recipe` extra: recipe-scrapers 15.13.0, with BeautifulSoup and extruct (lxml
was there already, for OCRmyPDF).

`docker images` says 3.2 GB (1.06 GB to download), most of it cuBLAS. Without the recipe parts it was
3.17 GB (1.05 GB to download): recipe-scrapers and what it brings take about 20 MB. Without the OCR
parts too it was 2.58 GB (890 MB to download). OpenCV is about 150 MB of that difference, Tesseract
and its libraries about 105 MB.

Two pins matter. `av==18.1.0`, because faster-whisper 1.2.1 calls `av.open(metadata_errors=…)`,
which PyAV 19 removed. `ctranslate2==4.9.0`, because the no-cuDNN point above depends on it.

## Trying it

### Speech to text

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

### Reading scans

`--ocr` reads one or more images as the pages of one scan, without a server. `--crop` looks for the
page in each photo, as for a photo from the website. It prints JSON: the text, each page's text,
whether it was cropped (and where its corners were), and the timings. It writes the PDF next to the
first image (`NAME.ocr.pdf`), and each cropped page too (`NAME.cropped.jpg`):

```sh
docker run --rm -v "$PWD":/scans -e PUID=$(id -u) -e PGID=$(id -g) \
  ghcr.io/svennefenne/noterat-worker:latest python -m noterat_worker --ocr /scans/receipt.jpg --crop
```

Without Docker you need Tesseract with Swedish (`tesseract-ocr-swe` on Debian and Ubuntu,
`tesseract-data-swe` on Arch; `tesseract --list-langs` should list `swe`), and the `ocr` extra:
`pip install -e '.[ocr]'`.

Here's how it read a synthetic receipt photo: a receipt rendered with Pillow, warped onto a darker
wooden table at 7° and in perspective, with a shadow, uneven light, a little blur and noise
(3024 × 4032, like a phone's). It ran in the image on a desktop CPU. Finding and straightening the
page took 0.1 s, its corners within 6 px of where they were drawn. Reading it took 2.9 s (three
pages together took 3.1 s: OCRmyPDF reads them side by side). Of the receipt's 19 lines, 15 came out
exactly right, and the shop, the date, every price, `TOTALT 122,34` and `Kort 122,34` were all read
right:

```
ICA Nära Ekhagen
Ekhagsvägen 12, Stockholm
Org.nr 556123-4567
Tel 08-123 45 67

2026-11-14 17:42 Kassa 2 KV 472.
Mjölk 1,5 I 16,90
Kaffe Gevalia 450 g 59,90
Brod Skogaholm 32,50
Bananer 21,04
0,845 kg x 24,90 kr/kg
Pant 2,00
Rabatt kaffe -10,00
TOTALT 122,34
Kort 122,34
Visa Debit **** 1234
Moms% Moms Netto Brutto
12,00 13 11 109,23 127,34
Tack för besöket!
Välkommen åter
```

What went wrong: `Kv 4711` became `KV 472.`, `1,5 l` became `1,5 I` (the font's l and I look
alike), `Bröd` lost its ring, and the VAT line read `13 11` and `127,34`. A photo with no page in it
(only the table) was left uncropped and read as empty. A receipt photographed lying sideways was
cropped, turned by `--rotate-pages` and read as well as the upright one. A letter photographed at a
slant came out word for word. Uncropped, a photo at 7° still read 10 of the 19 lines; cropped, the
same photo read 15.

### Reading recipes

`--recipe` reads a saved web page as a recipe job would, without a server, and prints JSON: `recipe`
(exactly what `done` would send), `read_by` (the site's own scraper, e.g. `arla.se`, or
`schema.org`), `missing` (the fields the page hasn't got, and what recipe-scrapers raised for each),
the encoding and the time it took. `--url` is the address the page was saved from, which says which
site it is. Nothing is fetched:

```sh
curl -sSLo page.html https://www.arla.se/recept/kottbullar/
docker run --rm -v "$PWD":/pages:ro ghcr.io/svennefenne/noterat-worker:latest \
  python -m noterat_worker --recipe /pages/page.html --url https://www.arla.se/recept/kottbullar/
```

Without Docker: `pip install -e '.[recipe]'`, then `python -m noterat_worker --recipe page.html --url …`.

Arla's Köttbullar page (246 kB, read in 0.12 s) came out with its title, all 22 ingredients (the
meatballs', the mash's, the lingonberries' and the pickled cucumber's, one list), 15 steps (with the
page's section names, `Köttbullar:` and `Potatismos:`, as steps of their own), 4 servings, 45 minutes,
its picture and its description, read by recipe-scrapers' scraper for `arla.se` (which takes the
ingredients from the page's table rather than its JSON-LD). Noterat's server reads this page's
JSON-LD itself, so it wouldn't reach the worker; it shows how the worker reads a real page.

## Tests

```sh
cd apps/worker
pip install pytest recipe-scrapers   # a fake model and a fake scanner: no faster-whisper, no Tesseract
python -m pytest
```

They run the real loop and HTTP client against a fake Noterat (`tests/fake_noterat.py`, a
`http.server` in a thread). For transcription they cover:

- a job going through next → file → progress → done
- 204s followed by a job
- failed with and without retry
- a 409 on progress
- a wrong token
- back-off while the server is down
- a done that has to be sent again
- stopping in the middle of a job
- SIGTERM cutting a long poll short

For scans (`tests/test_ocr.py`, with a fake scanner):

- a job going through next → files → progress → uploads → done: a cropped page uploaded and its new
  hash in `done`, the other pages keeping theirs, the PDF uploaded, the text joined
- a 409 on progress or on an upload
- a file that isn't an image (`retry: false`), a reading that fails (`retry: true`), a language
  Tesseract hasn't got, a page missing on the server
- stopping in the middle of the reading
- `WORKER_KINDS`, and a worker that only reads scans never loading Whisper

For recipes (`tests/test_recipe.py`):

- a job going through next → file → done, with recipe-scrapers reading a Swedish page's JSON-LD
  (`Köttbullar med gräddsås`), and what `done` sends, field by field
- a page with no recipe (`retry: false`), a page in ISO-8859-1 read by its `<meta>`, the same page
  as the server keeps it (UTF-8, its `<meta>` unchanged), microdata, an XHTML page, a site with a
  scraper of its own (`ica.se`), a recipe missing most fields
- that reading never opens a connection
- with a fake reader: an error in recipe-scrapers (`retry: true`), a file that isn't a page, a job
  without a page or an address, a page missing on the server, a `409` on `done`
- the encodings, the tidying (servings, lengths, long steps split), `WORKER_KINDS`, a worker that only
  reads recipes loading neither Whisper nor OCR, and one without recipe-scrapers going on without it

The tests that read with recipe-scrapers skip themselves when it isn't installed.

`tests/test_engines.py` tries the real page finder and Tesseract on synthetic images: a page warped
onto a dark table found to within 1 %, no page found where there's no clear one, EXIF orientation,
files that aren't images, and a Swedish receipt read through OCRmyPDF, flat and photographed. Each
test skips itself when OpenCV, or Tesseract with `swe`, isn't installed. To run them all, use the
image (the receipt is drawn with a system font that has å, ä and ö, so lend it the host's):

```sh
docker run --rm --entrypoint sh -v "$PWD/tests":/app/tests:ro -v /usr/share/fonts:/usr/share/fonts:ro \
  ghcr.io/svennefenne/noterat-worker:latest \
  -c 'pip install -q pytest && python -m pytest -q -p no:cacheprovider'
```

CI (`.github/workflows/worker.yml`) runs them with OpenCV and recipe-scrapers but without Tesseract
(so the tests that read scans skip), then builds `ghcr.io/svennefenne/noterat-worker`.
