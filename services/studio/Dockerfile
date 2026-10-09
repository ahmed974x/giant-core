FROM python:3.12-slim
RUN useradd --create-home --uid 1000 omega
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app.py data.py ./
USER omega
EXPOSE 5006
CMD ["panel", "serve", "app.py", "--port", "5006", "--address", "0.0.0.0", \
     "--allow-websocket-origin=localhost:5006", "--allow-websocket-origin=127.0.0.1:5006", \
     "--num-procs", "1", "--index", "app"]
