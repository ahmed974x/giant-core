# Build context ./services (the loop uses the same local code and the shared Postgres driver pin).
FROM python:3.12-slim
RUN useradd --create-home --uid 1000 omega
WORKDIR /app
COPY loop/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY loop/critic.py loop/engine.py loop/models.py loop/server.py loop/sources.py loop/store.py ./
USER omega
ENV PYTHONUNBUFFERED=1
CMD ["python", "server.py"]
