# DHA's own screenshot reader. Built and run on the SERVER only (never on the developer PC: owner decision, 24 Nov 2026).
# NOT YET BUILT: written from the PaddleOCR documentation, to be built and checked on the server (see README).
FROM python:3.11-slim

# libraries PaddleOCR's image code needs
RUN apt-get update \
 && apt-get install -y --no-install-recommends libgl1 libglib2.0-0 libgomp1 \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /srv
COPY requirements.txt requirements-engine.txt ./
RUN pip install --no-cache-dir -r requirements.txt -r requirements-engine.txt

RUN useradd --create-home --home-dir /home/reader reader
COPY --chown=reader app ./app
USER reader

# Download the OCR models while building (into the reader user's home), so the first payment after a restart is not slow.
# If this step cannot run, the models are downloaded on first use instead.
RUN python -c "from app.engines.paddle import PaddleEngine; PaddleEngine()" || echo "model warm-up skipped"

ENV PYTHONUNBUFFERED=1
EXPOSE 8080
# one worker process: the OCR model is large; concurrency inside it is limited by READER_MAX_CONCURRENCY
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8080", "--workers", "1"]
