FROM python:3.12-slim
RUN useradd --create-home --uid 1000 omega
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app.py ./
USER omega
EXPOSE 8094
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8094"]
