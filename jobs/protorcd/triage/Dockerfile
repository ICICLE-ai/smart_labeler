# ProtoRCD triage service (CPU only: the triage core needs numpy + scikit-learn, no torch).
# Build from this folder:  docker build -t protorcd-triage .
# Run:                     docker run -p 8000:8000 -v $PWD/triage_data:/data protorcd-triage
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    TRIAGE_DATA_DIR=/data

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY LICENSE ./
COPY protorcd_pipeline ./protorcd_pipeline
COPY serving ./serving
COPY triage_service ./triage_service

RUN useradd --uid 1000 --create-home triage && mkdir -p /data && chown triage /data
USER 1000
VOLUME ["/data"]
EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/healthz')"

# One worker: sessions live in this process (their journals make restarts safe).
# WebSocket pings every 20s keep idle review screens alive through proxies.
CMD ["uvicorn", "triage_service.app:app", "--host", "0.0.0.0", "--port", "8000", \
     "--workers", "1", "--ws-ping-interval", "20", "--ws-ping-timeout", "20", \
     "--proxy-headers", "--forwarded-allow-ips", "*"]
