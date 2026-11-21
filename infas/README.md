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
