FROM pgvector/pgvector:pg16

RUN apt-get update \
  && apt-get install -y curl ca-certificates gnupg build-essential python3 \
  && curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
  && apt-get install -y nodejs \
  && apt-get clean \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /opt/continuum

COPY storage /opt/continuum/storage
COPY runtime /opt/continuum/runtime
COPY visualization /opt/continuum/visualization
COPY entrypoint.mjs /opt/continuum/entrypoint.mjs

RUN cd /opt/continuum/storage \
  && npm ci \
  && npm run build

RUN cd /opt/continuum/runtime \
  && npm ci \
  && npm run build

RUN cd /opt/continuum/visualization \
  && npm ci \
  && npm run build

RUN cp -R /opt/continuum/visualization/.next/standalone/. /opt/continuum/visualization-standalone \
  && cp -R /opt/continuum/visualization/.next/static /opt/continuum/visualization-standalone/.next/static \
  && cp -R /opt/continuum/visualization/public /opt/continuum/visualization-standalone/public

EXPOSE 3001 3002 3003 31434 5432

ENTRYPOINT ["node", "/opt/continuum/entrypoint.mjs"]
