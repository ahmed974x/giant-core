# Build context is ./services (the worker shares ameen's embedder so both use the same local code).
FROM python:3.12-slim
RUN useradd --create-home --uid 1000 omega
WORKDIR /app
COPY mind/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY ameen/embed.py ./embed.py
COPY mind/atomise.py mind/linker.py mind/clusters.py mind/analysis.py mind/exporter.py mind/store.py \
     mind/service.py mind/server.py mind/worker.py mind/main.py ./
USER omega
ENV PYTHONUNBUFFERED=1
# The second brain's API (internal network only) and the nightly run; the Markdown export goes to /export.
CMD ["python", "main.py"]
