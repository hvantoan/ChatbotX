FROM node:24.22.1-trixie-slim AS base

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

WORKDIR /app

FROM base AS pre
RUN npm install -g turbo@^2

WORKDIR /app
COPY . .
RUN turbo prune zalo-personal-gateway --docker

FROM base AS deps
ENV NODE_OPTIONS="--max-old-space-size=4096"

WORKDIR /app
COPY --from=pre /app/out/json/ .
RUN pnpm install --frozen-lockfile --ignore-scripts

COPY --from=pre /app/out/full/ .
RUN SKIP_ENV_CHECK=true pnpm turbo run build --filter=zalo-personal-gateway

FROM base AS release
RUN apt-get update && \
  apt-get install -y --no-install-recommends curl tini && \
  apt-get clean && \
  rm -rf /var/lib/apt/lists/*

COPY --from=deps /app/apps/zalo-personal-gateway/dist /app/apps/zalo-personal-gateway/dist

USER node
ENTRYPOINT ["tini", "--"]
CMD ["node", "apps/zalo-personal-gateway/dist/index.mjs"]
STOPSIGNAL SIGTERM
EXPOSE 3220
