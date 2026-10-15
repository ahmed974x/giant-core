FROM python:3.12-slim
RUN useradd --create-home --uid 1000 omega
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY *.py ./
COPY migrations ./migrations
RUN mkdir /data && chown omega:omega /data
USER omega
ENV OMP_NUM_THREADS=1 PYTHONUNBUFFERED=1
EXPOSE 9108
# Live public AIS when AISSTREAM_API_KEY is set, otherwise the paced mock replay; metrics on :9108
CMD ["python", "pipeline.py", "--seconds", "31536000", "--metrics-port", "9108"]
