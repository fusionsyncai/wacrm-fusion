FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

COPY pyproject.toml .
COPY src ./src

RUN pip install --no-cache-dir .

RUN python -m wacrm_voice_agent.agent download-files

CMD ["python", "-m", "wacrm_voice_agent.agent", "start"]
