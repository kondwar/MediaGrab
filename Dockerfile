FROM python:3.12-slim

WORKDIR /app

# تثبيت FFmpeg لأن yt-dlp يحتاجه لبعض عمليات الدمج والتحويل
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# تثبيت متطلبات Backend
COPY backend/requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

# نسخ Backend
COPY backend/ /app/backend/

# نسخ الواجهة
COPY web/ /app/web/
COPY translations/ /app/translations/

EXPOSE 8080

CMD ["uvicorn", "backend.app:app", "--host", "0.0.0.0", "--port", "8080"]
