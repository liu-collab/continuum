FROM pgvector/pgvector:pg16

RUN apt-get update \
  && apt-get install -y curl ca-certificates gnupg \
  && curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
  && apt-get install -y nodejs \
  && apt-get clean \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /opt/axis

COPY storage /opt/axis/storage
COPY runtime /opt/axis/runtime
COPY visualization /opt/axis/visualization-standalone

COPY entrypoint.mjs /opt/axis/entrypoint.mjs

EXPOSE 3001 3002 3003 5432

ENTRYPOINT ["node", "/opt/axis/entrypoint.mjs"]
