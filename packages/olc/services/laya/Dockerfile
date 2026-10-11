FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    HF_HOME=/models \
    LAYA_HOST=0.0.0.0 \
    LAYA_PORT=8000 \
    LAYA_PRELOAD=0 \
    LAYA_DEVICE=cpu

RUN python -m pip install --no-cache-dir torch --index-url https://download.pytorch.org/whl/cpu \
    && python -m pip install --no-cache-dir "laya[serve]==0.3.21"

VOLUME ["/models"]
EXPOSE 8000

WORKDIR /app
COPY server.py ./server.py

CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8000"]
