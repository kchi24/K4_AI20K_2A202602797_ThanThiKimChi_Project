FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

COPY requirements.txt ./
# The simulator only needs the shared API section of the single requirements file.
RUN sed -e 's/\r$//' -e '/^# Backend-only runtime$/,$d' requirements.txt > /tmp/requirements-lms.txt \
    && pip install --no-cache-dir -r /tmp/requirements-lms.txt

RUN apt-get update \
    && apt-get install -y --no-install-recommends gosu \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --create-home appuser

COPY --chown=appuser:appuser lms-simulator/app ./app
COPY --chown=appuser:appuser lms-simulator/static ./static
COPY lms-simulator/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh

RUN sed -i 's/\r$//' /usr/local/bin/docker-entrypoint.sh \
    && chmod 0755 /usr/local/bin/docker-entrypoint.sh

EXPOSE 8010

HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=5 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8010/api/health')"

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8010"]
