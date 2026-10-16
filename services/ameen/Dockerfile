FROM python:3.12-slim
RUN useradd --create-home --uid 1000 omega
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY ameen.py embed.py ./
USER omega
ENV PYTHONUNBUFFERED=1
# Fills missing embeddings every minute and runs the nightly memory sleep at AMEEN_SLEEP_HOUR (UTC).
CMD ["python", "ameen.py"]
