FROM python:3.12-slim
RUN useradd --create-home --uid 1000 omega
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app.py plugin_manager.py ./
RUN mkdir plugins && chown omega:omega plugins
USER omega
EXPOSE 8501
CMD ["streamlit", "run", "app.py", "--server.address=0.0.0.0", "--server.headless=true", "--browser.gatherUsageStats=false"]
