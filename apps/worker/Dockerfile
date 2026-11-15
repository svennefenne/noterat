# syntax=docker/dockerfile:1.7
# Noterat's worker: speech to text with KB-Whisper through faster-whisper, on an Nvidia GPU (or, slowly,
# on the CPU); reading scans: the page found in a photo with OpenCV, read by Tesseract through OCRmyPDF
# into a searchable PDF; and reading recipes out of web pages the server fetched, with recipe-scrapers.
# It asks Noterat for work over HTTP and keeps nothing but the model, in /models.
#
# No CUDA base image: the driver comes from the host (the Nvidia runtime mounts it in), and the one
# CUDA library CTranslate2 4.9 loads, cuBLAS 12, comes from pip. FFmpeg comes inside PyAV's wheel.
# Tesseract comes from Debian, with Swedish and English (and osd, with which it tells which way up a
# page is). OCRmyPDF 17 rasterizes with pypdfium2 and writes a plain PDF itself, so it needs neither
# Ghostscript nor (as it's run, without --clean) unpaper.
ARG PYTHON_IMAGE=python:3.12-slim
FROM ${PYTHON_IMAGE}
ARG NOTERAT_VERSION=dev
LABEL org.opencontainers.image.title="Noterat worker" \
      org.opencontainers.image.description="Speech to text for Noterat's voice memos (KB-Whisper on an Nvidia GPU), text and searchable PDFs from its scans (Tesseract), and recipes read out of web pages (recipe-scrapers)" \
      org.opencontainers.image.source="https://github.com/svennefenne/noterat"
RUN apt-get update && apt-get install -y --no-install-recommends gosu tini tzdata \
      tesseract-ocr tesseract-ocr-swe tesseract-ocr-eng \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app

# The dependencies (pyproject.toml's, and its cuda, ocr and recipe extras) in a layer of their own, so a
# change to the code doesn't fetch the 1.6 GB of them again.
COPY pyproject.toml ./
RUN python -c "import tomllib; p = tomllib.load(open('pyproject.toml', 'rb'))['project']; x = p['optional-dependencies']; print('\n'.join(p['dependencies'] + x['cuda'] + x['ocr'] + x['recipe']))" > /tmp/requirements.txt \
 && pip install --no-cache-dir --root-user-action=ignore -r /tmp/requirements.txt \
 && rm /tmp/requirements.txt

ENV LD_LIBRARY_PATH=/usr/local/lib/python3.12/site-packages/nvidia/cublas/lib \
    NVIDIA_VISIBLE_DEVICES=all \
    NVIDIA_DRIVER_CAPABILITIES=compute,utility \
    MODELS_DIR=/models \
    HF_HOME=/models/.huggingface \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    NOTERAT_VERSION=${NOTERAT_VERSION} \
    PUID=99 PGID=100 UMASK=002 \
    TZ=Europe/Stockholm
COPY noterat_worker ./noterat_worker
COPY entrypoint.sh /entrypoint.sh
RUN chmod 755 /entrypoint.sh && mkdir -p /models \
 && python -c "import ctranslate2, faster_whisper, noterat_worker.whisper, noterat_worker.ocr, noterat_worker.pages" \
 && python -c "from noterat_worker.scraper import Scraper; Scraper().warm_up()" \
 && tesseract --list-langs | grep -qx swe
VOLUME /models
ENTRYPOINT ["/usr/bin/tini", "--", "/entrypoint.sh"]
CMD ["python", "-m", "noterat_worker"]
