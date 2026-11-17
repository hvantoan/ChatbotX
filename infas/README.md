# Infrastructure (`infas/`)

Docker Compose configurations for **ChatbotX** split cleanly between development and production.

## Files

- [`docker-compose.dev.yml`](./docker-compose.dev.yml): Local development stack (`chatbotx-dev`) with exposed DB/Redis/UI ports (`postgres`, `redis`, `filesystem`, `adminer`, `mailhog`, `redis-ui`), `builder`, `worker`, `javascript-executor`, `realtime`, and `zalo-personal-gateway`.
- [`docker-compose.prod.yml`](./docker-compose.prod.yml): Production stack (`chatbotx-prod`) without dev tools (`adminer`, `mailhog`, `redis-ui`), with internal-only DB/Redis/gateway ports, strict required env vars, `cap_drop: [ALL]`, `no-new-privileges:true`, `read_only: true` on isolated services, and memory/CPU resource limits.

## Usage

### Development

```bash
cp .env.example .env
docker compose -f infas/docker-compose.dev.yml up -d
```

To run only infrastructure (Postgres, Redis, RustFS, MailHog, Adminer, RedisInsight) while running Node apps locally via `pnpm dev`:

```bash
docker compose -f infas/docker-compose.dev.yml up -d postgres redis filesystem filesystem-init adminer mailhog redis-ui
```

### Production

```bash
docker compose -f infas/docker-compose.prod.yml up -d --build
```

> **Note:** In production, `zalo-personal-gateway` and `javascript-executor` are not published to host ports; `builder` and `worker` reach them over the internal Docker bridge network (`http://zalo-personal-gateway:3220`, `http://javascript-executor:3210`).
