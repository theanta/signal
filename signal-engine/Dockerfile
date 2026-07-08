FROM python:3.11-slim

WORKDIR /app

# System deps for lxml/scipy build + Playwright/Chromium runtime
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libxml2-dev \
    libxslt1-dev \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Installs Chromium for Playwright + Patchright and OS-level deps (runs as root,
# unlike Render's native build step which fails to elevate via su)
RUN crawl4ai-setup

COPY . .

EXPOSE 8001
CMD uvicorn main:app --host 0.0.0.0 --port ${PORT:-8001}
