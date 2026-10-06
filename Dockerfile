FROM node:22-bookworm-slim

WORKDIR /app


# =========================================================
# System packages
# =========================================================

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        python3 \
        python3-pip \
        python3-venv \
        ffmpeg \
        git \
        ca-certificates \
    && rm -rf /var/lib/apt/lists/*


# =========================================================
# Python virtual environment
# =========================================================

RUN python3 -m venv /opt/venv

ENV PATH="/opt/venv/bin:$PATH"


# =========================================================
# Python dependencies
# =========================================================

COPY backend/requirements.txt /app/requirements.txt

RUN pip install --no-cache-dir --upgrade pip \
    && pip install --no-cache-dir -r /app/requirements.txt


# =========================================================
# bgutil PO Token provider
# =========================================================

RUN git clone \
    --depth 1 \
    --branch 2.0.0 \
    https://github.com/Brainicism/bgutil-ytdlp-pot-provider.git \
    /opt/bgutil


# =========================================================
# Build bgutil HTTP server
# =========================================================

WORKDIR /opt/bgutil/server

RUN npm ci \
    && npx tsc


# =========================================================
# Application
# =========================================================

WORKDIR /app

COPY backend/ /app/backend/
COPY web/ /app/web/
COPY translations/ /app/translations/


# =========================================================
# Port
# =========================================================

EXPOSE 8080


# =========================================================
# Start:
#   1. bgutil on localhost:4416
#   2. MediaGrab API on 8080
# =========================================================

CMD ["sh", "-c", "node /opt/bgutil/server/build/main.js --host 127.0.0.1 --port 4416 & exec uvicorn backend.app:app --host 0.0.0.0 --port 8080"]
