# Observability tối giản (Beszel + Gatus + Dozzle)

Stack nhẹ nhất cho host 4 vCPU / 4 GB: ~120–150 MB RAM thực tế, không cần Alloy/Grafana/TSDB.

| Thành phần | Vai trò | URL (loopback) |
|---|---|---|
| **Beszel** (hub + agent) | CPU/RAM/disk/net host + từng container, lịch sử, alert Telegram | http://127.0.0.1:8090 |
| **Gatus** | Health check HTTP/TCP, alert Telegram khi fail 3 lần liên tiếp | http://127.0.0.1:8081 |
| **Dozzle** | Xem log realtime mọi container (không lưu) | http://127.0.0.1:8080 |

Lưu trữ log lịch sử **không** có trong stack này — thêm OpenObserve/VictoriaLogs khi cần (xem `plans/reports/research-261124-1448-selfhost-observability-chatbotx.md` §12).

## 1. Tạo bot Telegram

1. Chat `@BotFather` → `/newbot` → lấy **token**.
2. Gửi `/start` cho bot vừa tạo.
3. Lấy chat id: `curl -s "https://api.telegram.org/bot<TOKEN>/getUpdates" | jq '.result[0].message.chat.id'`
   (nhóm thì thêm bot vào nhóm rồi lấy id âm, ví dụ `-1001234567890`).

## 2. Chạy

```bash
cd infas/observability
cp .env.example .env       # điền TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID
# nếu stack ChatbotX không tên "chatbotx-prod" thì sửa CHATBOTX_NETWORK
docker compose up -d       # beszel + dozzle + gatus
```

Kiểm tra:

```bash
docker compose ps
curl -s -o /dev/null -w 'beszel %{http_code}\n' http://127.0.0.1:8090/
curl -s -o /dev/null -w 'gatus  %{http_code}\n' http://127.0.0.1:8081/health
curl -s -o /dev/null -w 'dozzle %{http_code}\n' http://127.0.0.1:8080/
curl -s http://127.0.0.1:8081/api/v1/endpoints/statuses | jq -r '.[] | "\(.name) \(.success)"'
```

## 3. Bật agent Beszel (metric + alert container)

1. Mở http://127.0.0.1:8090 → tạo admin.
2. **Settings → Notifications** → thêm URL shoutrrr:
   `telegram://<BOT_TOKEN>@telegram?chats=<CHAT_ID>`
   → bấm Test để xác nhận Telegram nhận được.
3. **Add System** → chọn socket → copy `KEY` và `TOKEN` vào `.env`.
4. `docker compose --profile agent up -d`
5. Trong dialog Add System, Host/IP = `/beszel_socket/beszel.sock`, rồi Add.
6. Bật alert cho system trong bảng Systems (CPU/RAM/disk/status, có threshold + thời gian).

## 4. Alert mặc định

- **Gatus**: fail 3 lần liên tiếp (≈3 phút) → Telegram; resolved khi 2 lần thành công liên tiếp. Endpoint: builder `/api/health`, realtime `/health`, TCP postgres:5432, TCP redis:6379. Zalo gateway để comment sẵn trong `gatus/config.yaml`.
- **Beszel**: ngưỡng đặt trong UI (ví dụ RAM > 90% trong 10 phút, disk > 90%, container down).

## 6. Giới hạn tài nguyên

Compose đã đặt **trần cứng** (cap) cho từng container, cộng thêm log rotation 10 MB × 2 file để không bao giờ đầy disk vì log của chính monitoring:

| Container | RAM cap | CPU cap | pids | RAM thực tế đo được |
|---|---|---|---|---|
| obs-beszel | 128M | 0.50 | 128 | ~12 MB |
| obs-beszel-agent | 64M | 0.25 | 64 | ~10–15 MB |
| obs-dozzle | 64M | 0.25 | 128 | ~14 MB |
| obs-gatus | 64M | 0.25 | 128 | ~7 MB |
| **Tổng** | **320M** | **1.25** | — | **~35–50 MB** |

Kiểm tra cap đã được Docker áp:

```bash
docker inspect -f '{{.Name}} mem={{.HostConfig.Memory}} cpu={{.HostConfig.NanoCpus}} pids={{.HostConfig.PidsLimit}}' \
  obs-beszel obs-beszel-agent obs-dozzle obs-gatus
docker stats --no-stream --format '{{.Name}}\t{{.MemUsage}}\t{{.CPUPerc}}'
```

Nếu container chạm cap, nó bị OOM-kill thay vì kéo cả host: đây là hành vi mong muốn trên host 4 GB. Tăng cap chỉ khi `docker stats` cho thấy chạm trần thường xuyên.

### Giới hạn cho stack ChatbotX

`infas/docker-compose.limits.yml` đặt cap cho builder/worker/realtime/js-executor/zalo/postgres/redis/rustfs (tổng 3.95 GB cap, thực tế thấp hơn nhiều):

```bash
docker compose -f infas/docker-compose.prod.yml \
               -f infas/docker-compose.limits.yml up -d
```

Đây là thay đổi có ảnh hưởng vận hành (giảm 2G → 1G cho builder/worker): chạy `docker stats` trước, và theo dõi OOM trong 24h đầu.

## 7. Giới hạn đã biết

- **Worker không có HTTP health endpoint** (chỉ builder/realtime/js-executor/gateway có) → Gatus không check được; theo dõi qua Beszel (container chết/restart) và log Dozzle. Muốn alert theo queue/error thì cần thêm log backend hoặc health server trong worker.
- **javascript-executor** nằm ở network `javascript-executor-network` (internal), Gatus ở `chatbotx-network` không tới được → không đưa vào check.
- Monitoring chạy cùng host: host chết thì không có alert. Cần thêm một uptime check bên ngoài (Uptime Kuma/Better Stack/Gatus thứ hai ở máy khác).
- Mọi port bind `127.0.0.1`; truy cập từ xa qua SSH tunnel hoặc reverse proxy có auth. Không mở trực tiếp ra Internet.
