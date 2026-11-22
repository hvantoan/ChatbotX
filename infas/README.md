# Infrastructure (`infas/`)

Docker Compose configurations for **ChatbotX** split cleanly between development and production.

- [`../docker-compose.dev.yml`](../docker-compose.dev.yml): local dev stack (`chatbotx`) — full app containers (`builder`, `worker`, `javascript-executor`, `realtime`) on top of the root infra compose (`postgres`, `redis`, `filesystem`, `adminer`, `mailhog`, `redis-ui`, profile `zalo-personal`). One-click entrypoint: [`../scripts/stack-up.sh`](../scripts/stack-up.sh).
- [`docker-compose.prod.yml`](./docker-compose.prod.yml): production stack (`chatbotx-prod`) without dev tools (`adminer`, `mailhog`, `redis-ui`), with internal-only DB/Redis/gateway ports, strict required env vars, `cap_drop: [ALL]`, `no-new-privileges:true`, `read_only: true` on isolated services, and memory/CPU resource limits.

## Usage

### Development — one click

```bash
./scripts/stack-up.sh            # env → build → up → migrate+seed → health check
./scripts/stack-up.sh --down     # stop everything
./scripts/stack-up.sh --reset    # wipe volumes + generated env, start fresh
```

The script generates `.env` (from `.env.example` with fresh secrets) and
`.env.docker` (container-side overrides: `postgres`/`redis`/`filesystem`/
`mailhog` hostnames) — no manual env editing needed. Migrations and the demo
seed run inside the builder container (`RUN_DB_MIGRATE`/`RUN_DB_SEED`).

To run only infrastructure while developing Node apps on the host via `pnpm dev`,
use the root compose (see `scripts/dev-up.sh`):

```bash
docker compose up -d postgres redis filesystem filesystem-init adminer mailhog redis-ui
```

### Production

```bash
docker compose --env-file ../.env -f infas/docker-compose.prod.yml up -d --build
```

All five application images are built locally from `apps/*/docker/Dockerfile`, so a fresh install needs no registry access (this repository's images must run the code in this checkout — the upstream `ghcr.io/chatbotxio/*` images do not contain fork-specific features such as `zalo-personal`). The built tag for each service can be overridden with its `CHATBOTX_*_IMAGE` variable.

The stack bundles `filesystem` (RustFS) for object storage, mirroring the root `docker-compose.yml`: point `S3_ENDPOINT` at `http://filesystem:9000`, `S3_BUCKET=chatbotx`, and reuse the `RUSTFS_ACCESS_KEY`/`RUSTFS_SECRET_KEY` values as the S3 credentials. The `public/` key prefix is anonymous-readable (channel media, avatars); everything else stays private. To use an external S3-compatible store (e.g. Cloudflare R2) instead, set `S3_*` to that endpoint — the `filesystem` services can then be left out.

> **Env gotcha:** `docker compose` interpolates `${VAR:?}` from the shell and the project-directory `.env` (i.e. `infas/.env`), **not** from the `env_file: ../.env` that containers receive. Run every command with `--env-file ../.env` (or copy the env to `infas/.env`) or `config`/`up` fails with `required variable ... is missing a value`.
>
> ```bash
> docker compose --env-file ../.env -f infas/docker-compose.prod.yml up -d --build
> ```

> **Note:** In production, `zalo-personal-gateway` and `javascript-executor` are not published to host ports; `builder` and `worker` reach them over the internal Docker bridge network (`http://zalo-personal-gateway:3220`, `http://javascript-executor:3210`).

> **Zalo Personal sessions:** the gateway keeps logged-in sessions in memory only, so restarting it drops every account. The worker's `restoreZaloPersonalSessions` schedule (every minute) starts a session for each connected account the gateway no longer tracks, so the worker needs the same `ZALO_PERSONAL_GATEWAY_URL`/`ZALO_PERSONAL_GATEWAY_TOKEN` as the builder, plus `NEXT_PUBLIC_BROKER_URL` (or `NEXT_PUBLIC_BUILDER_URL`) reachable from the gateway, because that origin becomes the webhook URL. Until the restore runs (up to about a minute), sends fail with `409 session_not_connected` and can be resent. In the dev stack the gateway container runs the host's `apps/zalo-personal-gateway/dist` from a bind mount, so run `pnpm --filter zalo-personal-gateway build` and restart the container after changing gateway code.

#### Migrating existing attachments from RustFS to an external bucket

The bundled `filesystem` (RustFS) service keeps objects in a `filesystem-data-prod` volume. If you move `S3_*` to an external bucket (e.g. Cloudflare R2), the database keeps referencing the same object keys, so the objects must be copied to the new bucket — otherwise previously uploaded attachments and avatars stop opening after the switch.

1. Keep the old volume until verification passes:

   ```bash
   docker volume ls | grep filesystem-data-prod   # e.g. chatbotx-prod_filesystem-data-prod
   ```

2. Serve the old objects temporarily on the Docker host (the old compose created bucket `chatbotx`; credentials were `RUSTFS_ACCESS_KEY`/`RUSTFS_SECRET_KEY`):

   ```bash
   docker run --rm -d --name rustfs-old \
     -v chatbotx-prod_filesystem-data-prod:/data \
     -p 127.0.0.1:9000:9000 \
     rustfs/rustfs:latest server /data
   ```

3. Copy every object, preserving keys — e.g. with `rclone` using env-configured remotes:

   ```bash
   RCLONE_CONFIG_OLD_TYPE=s3 RCLONE_CONFIG_OLD_PROVIDER=Other \
   RCLONE_CONFIG_OLD_ENDPOINT=http://127.0.0.1:9000 \
   RCLONE_CONFIG_OLD_ACCESS_KEY_ID=$RUSTFS_ACCESS_KEY \
   RCLONE_CONFIG_OLD_SECRET_ACCESS_KEY=$RUSTFS_SECRET_KEY \
   RCLONE_CONFIG_NEW_TYPE=s3 RCLONE_CONFIG_NEW_PROVIDER=Cloudflare \
   RCLONE_CONFIG_NEW_ENDPOINT=$S3_ENDPOINT \
   RCLONE_CONFIG_NEW_ACCESS_KEY_ID=$S3_ACCESS_KEY_ID \
   RCLONE_CONFIG_NEW_SECRET_ACCESS_KEY=$S3_SECRET_ACCESS_KEY \
   rclone sync old:chatbotx new:$S3_BUCKET --progress
   ```

4. Verify before switching: `rclone check old:chatbotx new:$S3_BUCKET` must report no differences, then set `S3_ENDPOINT`/`S3_BUCKET`/`S3_ACCESS_KEY_ID`/`S3_SECRET_ACCESS_KEY` for R2, restart the stack, and open a previously uploaded attachment in a conversation.

5. Only after verification: `docker rm -f rustfs-old`, and remove the old volume (`docker volume rm chatbotx-prod_filesystem-data-prod`) once you are confident nothing still references it.
