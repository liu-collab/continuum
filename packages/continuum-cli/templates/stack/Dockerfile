FROM pgvector/pgvector:pg16 AS builder

RUN apt-get update \
  && apt-get install -y curl ca-certificates gnupg build-essential python3 \
  && curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
  && apt-get install -y nodejs \
  && apt-get clean \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /opt/continuum

COPY storage/package*.json /opt/continuum/storage/
COPY runtime/package*.json /opt/continuum/runtime/
COPY visualization/package*.json /opt/continuum/visualization/

RUN cd /opt/continuum/storage && npm ci
RUN cd /opt/continuum/runtime && npm ci
RUN cd /opt/continuum/visualization && npm ci

COPY storage /opt/continuum/storage
COPY runtime /opt/continuum/runtime
COPY visualization /opt/continuum/visualization

RUN cd /opt/continuum/storage && npm run build
RUN cd /opt/continuum/runtime && npm run build
RUN cd /opt/continuum/visualization && npm run build

RUN cp -R /opt/continuum/visualization/.next/standalone/. /opt/continuum/visualization-standalone \
  && cp -R /opt/continuum/visualization/.next/static /opt/continuum/visualization-standalone/.next/static \
  && cp -R /opt/continuum/visualization/public /opt/continuum/visualization-standalone/public

FROM pgvector/pgvector:pg16

RUN apt-get update \
  && apt-get install -y curl ca-certificates gnupg \
  && curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
  && apt-get install -y nodejs \
  && apt-get clean \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /opt/continuum

COPY --from=builder /opt/continuum/storage/dist /opt/continuum/storage/dist
COPY --from=builder /opt/continuum/storage/migrations /opt/continuum/storage/migrations
COPY --from=builder /opt/continuum/storage/node_modules /opt/continuum/storage/node_modules
COPY --from=builder /opt/continuum/storage/package.json /opt/continuum/storage/package.json

COPY --from=builder /opt/continuum/runtime/dist /opt/continuum/runtime/dist
COPY --from=builder /opt/continuum/runtime/migrations /opt/continuum/runtime/migrations
COPY --from=builder /opt/continuum/runtime/node_modules /opt/continuum/runtime/node_modules
COPY --from=builder /opt/continuum/runtime/package.json /opt/continuum/runtime/package.json

COPY --from=builder /opt/continuum/visualization-standalone /opt/continuum/visualization-standalone

COPY entrypoint.mjs /opt/continuum/entrypoint.mjs

EXPOSE 3001 3002 3003 5432

ENTRYPOINT ["node", "/opt/continuum/entrypoint.mjs"]
