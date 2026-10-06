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

ENV PYTHONUNBUFFERED=1


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
COPY start.sh /app/start.sh

# Analytics database folder (see DATABASE_URL in the README).
RUN mkdir -p /app/data && chmod 777 /app/data


# =========================================================
# Port
# =========================================================

EXPOSE 8080


# =========================================================
# Start (see start.sh):
#   1. bgutil on localhost:4416
#   2. Telegram bot (only if TELEGRAM_BOT_TOKEN is set)
#   3. MediaGrab API + web interface on 8080
# =========================================================

CMD ["sh", "/app/start.sh"]
