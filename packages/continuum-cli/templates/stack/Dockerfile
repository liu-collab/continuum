FROM pgvector/pgvector:pg16

RUN apt-get update \
  && apt-get install -y curl ca-certificates gnupg \
  && curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
  && apt-get install -y nodejs \
  && apt-get clean \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /opt/continuum

COPY storage /opt/continuum/storage
COPY runtime /opt/continuum/runtime
COPY visualization /opt/continuum/visualization-standalone

COPY entrypoint.mjs /opt/continuum/entrypoint.mjs

EXPOSE 3001 3002 3003 5432

ENTRYPOINT ["node", "/opt/continuum/entrypoint.mjs"]
