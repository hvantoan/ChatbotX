# Research: CLI/pattern để dựng shared dev stack (postgres, redis, rabbitmq) tái sử dụng giữa nhiều project

- **Ngày:** 2026-11-24 02:22 +07:00
- **Câu hỏi:** Có CLI nào dựng 1 stack infra (PG, Redis, RabbitMQ…) chạy 1 lần trên máy, các project khác nhau reuse — thay vì mỗi project compose lại một bộ DB riêng? Kèm nhu cầu build docker image cho dev.

## TL;DR

Không cần tool lạ — pattern chuẩn cộng đồng dùng là **một `docker-compose.yml` infra riêng + một shared Docker network (`external: true`)**. Mỗi project chỉ khai `networks: { infra_net: { external: true } }` và trỏ host `postgres`, `redis`, `rabbitmq` — xong. Các CLI "magic" (devenv, devbox) không giải quyết đúng bài toán này vì service của chúng vẫn per-project.

## Pattern khuyên dùng (KISS, đáp ứng đúng nhu cầu)

**1. Một repo/thư mục infra duy nhất trên máy:**

```bash
docker network create dev-net
```

```yaml
# ~/infra/docker-compose.yml
services:
  postgres:
    image: postgres:16
    container_name: shared-postgres
    ports: ["5432:5432"]
    volumes: ["pg_data:/var/lib/postgresql/data"]
    networks: [dev-net]
  redis:
    image: redis:7
    container_name: shared-redis
    ports: ["6379:6379"]
    networks: [dev-net]
  rabbitmq:
    image: rabbitmq:3-management
    container_name: shared-rabbitmq
    ports: ["5672:5672", "15672:15672"]
    networks: [dev-net]
  # + mailhog, minio/rustfs nếu cần (ChatbotX docker-compose.yml đã có sẵn các service này — tách chúng thành stack infra)
volumes:
  pg_data:
```

`docker compose up -d` một lần. Sống mãi, volume giữ data.

**2. Trong từng project**, chỉnh service app/worker join network ngoài và trỏ hostname theo tên container:

```yaml
networks:
  dev-net:
    external: true
```

**Ưu điểm:** không dependency mới, chạy trên mọi máy, đúng mental model của user ("tạo sẵn, project nào sài thì tái sử dụng").
**Lưu ý:** cần quy ước 1 DB/schema per project trong cùng instance PG (tạo bằng init script hoặc `createdb`), tránh app A đụng data app B. RabbitMQ tương tự: vhost per project.

## Các CLI từng được cân nhắc

| Tool | Có giải đúng bài không | Ghi chú |
|---|---|---|
| **docker compose + external network** | ✅ Đúng bài | Khuyên dùng. Đơn giản nhất. |
| **devenv (devenv.sh)** | ⚠️ Một nửa | `services.postgres.enable = true` tốt nhưng service **chạy per-project** qua process-compose — lại phân tán đúng thứ user muốn tránh. Có thể trỏ `devenv` sang connection string ngoài nhưng vậy thì dùng compose luôn. |
| **devbox (jetify)** | ❌ | Reproducible tool versions (Node/pnpm) tốt; services per-project. |
| **Dev Containers / DevPod** | ❌ | Env trong container, không phải shared infra. |
| **Tilt / Skaffold / DevSpace** | ❌ | Cho local K8s dev loop, overkill. |
| **direnv / mise** | ✅ Bổ trợ | Rất nên dùng kèm: `.envrc` per project inject `DATABASE_URL=postgres://...` vào shell — kết nối "tự nhiên" với stack shared. |
| **OrbStack / Colima** | ✅ Bổ trợ | Docker runtime nhẹ hơn Docker Desktop; OrbStack có `*.orb.local` domain đẹp cho shared services. |

Về phần "dựng docker image": nếu muốn build image từ source **không Dockerfile**: `pack` (Cloud Native Buildpacks, mature, `pack build app`), `ko` (Go only), **Railpack** (Railway, thay thế Nixpacks đã maintenance-mode năm 2025). Nếu đã có Dockerfile thì `docker build`/`docker buildx bake` là đủ — đừng thêm layer.

## Khuyến nghị cụ thể cho máy này

1. Tách `docker-compose.yml` của ChatbotX (PG+pgvector, Redis, RustFS, MailHog, Adminer, RedisInsight) thành stack `~/infra` shared, bỏ `depends_on` trỏ ngược app.
2. `docker network create dev-net`; gắn tất cả service infra vào.
3. Mỗi project thêm 3 dòng `external network` + env host trỏ container name (hoặc `localhost:port` qua published ports — đơn giản hơn nữa, khỏi đụng network).
4. `direnv` cho env per-project; `mise`/`devbox` chỉ để pin Node/pnpm version nếu cần.

## Sources

- [How to connect services across separate Docker Compose projects (external networks)](https://oneuptime.com/blog/post/2026-01-25-communication-between-docker-compose-projects/view)
- [tranthethang/docker-shared-services — reference compose infra stack](https://github.com/tranthethang/docker-shared-services)
- [Devbox vs Devenv — services are per-project](https://sumguy.com/devbox-vs-devenv-nix-without-pain/)
- [Reproducible Dev Environments 2026 — Devbox/devenv/DevPod/Dev Containers landscape](https://1337skills.com/blog/2026-07-18-reproducible-dev-environments-2026-devbox-devenv-devpod/)
- [Nixpacks → Railpack transition, maintenance mode 2025](https://techsy.io/en/blog/nixpacks-vs-docker)
- [Cloud Native Buildpacks / pack CLI](https://docs.cloud.google.com/docs/buildpacks/build-application)

## Unresolved

- Chưa rõ user muốn "dựng docker image" cho dev (image của app để chạy trong stack shared luôn) hay chỉ build image khi cần — nếu là cái đầu, có thể thêm Traefik/Caddy reverse-proxy để app container join `dev-net` với tên miền đẹp.
