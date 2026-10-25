# Multi-stage secure build for TrainWatch Backend
# Stage 1: Build dependencies
FROM python:3.13-slim AS builder

WORKDIR /build

RUN apt-get update && \
    apt-get install -y --no-install-recommends gcc && \
    rm -rf /var/lib/apt/lists/*

COPY pyproject.toml .
COPY src ./src

RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir hatchling && \
    pip wheel --no-cache-dir --no-deps --wheel-dir /build/wheels . && \
    pip wheel --no-cache-dir --wheel-dir /build/wheels -r <(python -c '
import tomllib
with open("pyproject.toml", "rb") as f:
    cfg = tomllib.load(f)
for dep in cfg.get("project", {}).get("dependencies", []):
    print(dep)
')

# Stage 2: Runtime
FROM python:3.13-slim AS runtime

# Create unprivileged system user
RUN groupadd -g 10001 appgroup && \
    useradd -u 10001 -g appgroup -s /bin/false -M appuser

WORKDIR /app

COPY --from=builder /build/wheels /wheels
RUN pip install --no-cache-dir --no-index --find-links=/wheels /wheels/* && \
    rm -rf /wheels

# Drop all privileges
USER 10001:10001

ENV PORT=8080 \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    APP_ENV=staging

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8080/healthz')" || exit 1

ENTRYPOINT ["uvicorn", "trainwatch.main:create_app", "--factory", "--host", "0.0.0.0", "--port", "8080"]
