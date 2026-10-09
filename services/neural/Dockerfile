FROM python:3.12-slim
RUN useradd --create-home --uid 1000 omega
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY model.py server.py ./
RUN mkdir /data && chown omega:omega /data
USER omega
ENV OMP_NUM_THREADS=1 MKL_NUM_THREADS=1
EXPOSE 8092
CMD ["python", "server.py"]
