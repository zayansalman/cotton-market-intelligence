# Cloud-first: build and run without a local Python install.
# Dashboard only (lean). Add ML layers in CI or a separate image if needed.
FROM python:3.11-slim-bookworm

WORKDIR /app

ENV PYTHONUNBUFFERED=1 \
    PYTHONPATH=/app \
    PIP_NO_CACHE_DIR=1

COPY requirements.txt requirements-dashboard.txt ./
RUN pip install --upgrade pip && \
    pip install -r requirements.txt -r requirements-dashboard.txt

# Optional: uncomment to bake HF NLP into the image (larger download at build).
# COPY requirements-ml.txt ./
# RUN pip install -r requirements-ml.txt

COPY src ./src
COPY config ./config
COPY dashboard ./dashboard
COPY scripts ./scripts

RUN mkdir -p /app/artifacts

EXPOSE 8501

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8501/_stcore/health')"

CMD ["streamlit", "run", "dashboard/app.py", "--server.address=0.0.0.0", "--server.port=8501", "--server.headless=true"]
