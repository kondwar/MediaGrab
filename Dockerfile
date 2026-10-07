FROM node:22-bookworm-slim

WORKDIR /app

# =========================================================
# System packages
# =========================================================

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        python3 \
        python3-venv \
        ffmpeg \
        git \
        ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# =========================================================
# Python virtual environment
# =========================================================

RUN python3 -m venv /opt/venv

ENV PATH="/opt/venv/bin:$PATH" \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

# =========================================================
# Python dependencies
# =========================================================

COPY backend/requirements.txt /tmp/requirements.txt

RUN pip install --no-cache-dir \
        -r /tmp/requirements.txt \
    && rm -f /tmp/requirements.txt

# =========================================================
# bgutil PO Token provider
# =========================================================

RUN git clone \
        --depth 1 \
        --branch 2.0.0 \
        https://github.com/Brainicism/bgutil-ytdlp-pot-provider.git \
        /opt/bgutil

# Build only the server
WORKDIR /opt/bgutil/server

RUN npm ci --no-audit --no-fund \
    && npx tsc \
    && npm cache clean --force

# =========================================================
# Application
# =========================================================

WORKDIR /app

COPY backend/ ./backend/
COPY web/ ./web/
COPY translations/ ./translations/
COPY start.sh ./start.sh

RUN chmod +x ./start.sh \
    && mkdir -p /app/data \
    && chmod 777 /app/data

# =========================================================
# Runtime
# =========================================================

EXPOSE 8080

CMD ["./start.sh"]
