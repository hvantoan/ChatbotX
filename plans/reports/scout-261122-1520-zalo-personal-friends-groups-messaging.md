# Scout Report — Zalo Personal: import bạn bè/nhóm, gửi/nhận realtime

Ngày: 2026-11-22 · Branch: `feat/zalo-personal-history-sync`

## Kết luận nhanh

- **Nhận tin realtime đã chạy end-to-end**: listener `message` → webhook ký HMAC → integration → job `incomingMessage` → worker `received-message.ts` (insert + broadcast realtime + trigger flow). Không cần xây mới, chỉ cần vá các khoảng trống bên dưới.
- **Gửi tin đã có**: inbox/flow → `outgoing-message.ts` → `POST /messages/send` → `api.sendMessage`. Thiếu echo tin gửi từ điện thoại và một số loại nội dung.
- **Import bạn bè/nhóm chưa có**. Gateway chỉ tạo contact gián tiếp khi có tin nhắn (history sync). Cần thêm endpoint gateway liệt kê friends/groups và một đường import vào contact.
- **Lỗ hổng vận hành lớn nhất**: session chỉ nằm trong RAM của gateway; khi gateway restart không có ai gọi lại `/accounts/start`, nên cả gửi lẫn nhận realtime chết cho tới khi user connect lại.

## Relevant Files

### Gateway (`apps/zalo-personal-gateway`)
- `src/session-manager.ts` — `ZaloSessionManager`: login zca-js, listener (`message`, `old_messages`, `connected`, `closed`), reconnect backoff, Redis listener lock, `syncHistory` (backfill nhóm qua `getCloudMessage`, tối đa 200 tin/nhóm), `sendMessage`, `forwardWebhook`. Đã dùng `getAllGroups`, `getGroupInfo`, `getUserInfo` — là chỗ tự nhiên để thêm `listFriends` / `listGroups`.
- `src/server.ts` — HTTP router (Bearer token). Route hiện có: `/qr/*`, `/accounts/verify|start|stop`, `/accounts/:uid/status`, `/accounts/:uid/sync`, `/messages/send`. Cần thêm route kiểu `GET /accounts/:uid/friends` và `GET /accounts/:uid/groups`, và mở rộng `GatewayServerDeps`.
- `src/index.ts` — boot; **không khôi phục session** khi khởi động.
- `src/lock.ts` — khóa Redis một listener/tài khoản (chống chạy trùng giữa các instance).
- `__tests__/session-sync.test.ts`, `session-backfill.test.ts`, `gateway.test.ts` — pattern test với fake API để tái dùng.

### Integration (`integrations/zalo-personal`)
- `src/lib/gateway-client.ts` — client gọi gateway (send, status, stop, sync). Thêm `listFriends`/`listGroups` ở đây.
- `src/handlers/webhook.ts` — xác thực HMAC, lọc self/group (`groupReplyConfig`), đẩy job `incomingMessage` / `incomingMessageEcho`.
- `src/handlers/message/incoming-message.ts` — map payload → `IncomingContact`/`IncomingMessage`. Quy ước sourceId: user = `threadId`, group = `group:<threadId>` (`toContactSourceId`). Import phải dùng **đúng quy ước này** để contact import khớp contact sinh ra từ tin nhắn.
- `src/handlers/message/outgoing-message.ts` — `sendMessage` (bỏ qua mọi `contentType` khác text) và `sendFlowStep` (text, image, multi-image, video, audio, file, gif; bước khác trả 0).
- `src/handlers/contact.ts` — rỗng; `conversation.ts` — `sendTyping` no-op.
- `src/schema.ts` — schema payload webhook, auth value.

### Builder (`apps/builder/src/features/integration-zalo-personal`)
- `api/public.ts` — public API: list/get/connect/update/delete/sync. Theo invariant 23, endpoint import friends/groups phải thêm ở đây trước UI.
- `lib/manage-zalo-personal.ts` — orchestration builder ↔ gateway (connect + compensate, sync, disconnect).
- `lib/gateway.ts` — client gateway phía builder (verify, start, sync…), dựng `webhookUrl`.
- `actions/sync.action.ts`, `components/zalo-personal-sync-button.tsx` — mẫu action + nút cho tính năng "Import".
- `apps/builder/src/app/integrations/[...integration]/webhook.ts` — route webhook (đang sửa trong branch).

### Business / Worker (tái dùng cho import)
- `packages/business/src/integration-zalo-personal/service.ts` — service integration (findById, getDecryptedCredentials…).
- `packages/business/src/contact/bulk-import-channel-contacts.ts` — `bulkImportChannelContacts({ inbox, workspaceId, contacts })`: dedupe theo sourceId, idempotent, race-safe, không tính MAC. **Đây là hàm import contact nên dùng.**
- `apps/worker/src/integration/handlers/contact-scan/` (`adapter.ts`, `engine.ts`, `adapters/messenger.ts`) + `docs/contact-scan.md` — khung Automatic Customer Scan (run state, chunk, cancel, rate-limit). Có thể thêm adapter `zalo_personal` thay vì tự xây job riêng.
- `apps/worker/src/integration/handlers/received-message.ts` — pipeline nhận tin chung (realtime broadcast, notification, event-bus).
- `apps/worker/src/schedule/handlers/refresh-channel-tokens.ts` — `zalo_personal: undefined` (không có refresh token; liên quan tới việc restore session).

## Khoảng trống theo từng tính năng

### 1. Pull bạn bè và nhóm để import
- Gateway: thêm `listFriends(zaloUid)` (zca-js `getAllFriends`) và `listGroups(zaloUid)` (`getAllGroups` + `getGroupInfo` theo chunk, như `enrichThreadMetadata`). Map sang `{ sourceId, firstName, avatar }` theo quy ước `group:` ở trên.
- Lựa chọn kiến trúc (cần quyết):
  - **A. Adapter Contact Scan** (`contactScanChannels` + adapter `zalo_personal`): có sẵn run lifecycle, cancel, UI "Contacts → Import". Nhưng engine giả định duyệt hội thoại mới→cũ với `scanFromAt`; danh sách friends không có thời gian, nên ngữ nghĩa "scan from" không khớp.
  - **B. Job riêng nhẹ**: public API `POST /v1/zalo-personal-channels/{id}/import-contacts` → enqueue job → gọi gateway → `bulkImportChannelContacts` theo trang. Đơn giản hơn, khớp nút Sync hiện tại.
- Inbox của channel: `integrationZaloPersonalModel.inboxId`.

### 2. Gửi tin nhắn
- `sendMessage` bỏ qua tin không phải text (`contentType !== text`), nên tin agent gửi kèm loại khác bị rơi im lặng.
- `selfListen: false`: tin gửi từ app Zalo trên điện thoại không về inbox (chỉ thấy qua history sync). Bật `selfListen: true` và để webhook đẩy `incomingMessageEcho` cho `isSelf` realtime (hiện webhook đang drop `isSelf` khi không phải history). Cần dedupe với tin do chính ChatbotX gửi (gateway trả `messageIds` → so khớp sourceId).
- `sendTyping` no-op, trong khi zca-js có `sendTypingEvent`.
- Không có idempotency khi worker retry job gửi (có thể gửi trùng).

### 3. Nhận tin realtime
- Đã hoạt động khi session đang sống. Thiếu:
  - Khôi phục session khi gateway khởi động (hoặc builder/worker định kỳ reconcile: với mỗi integration còn kết nối mà `/status` ≠ connected thì gọi `startAccount` với credentials đã giải mã).
  - `forwardWebhook` chỉ log khi lỗi, không retry; nếu builder down thì tin realtime mất (history `old_messages` chỉ chạy một lần mỗi session).
  - Không có sự kiện reaction / undo (thu hồi) / seen / delivered.
  - `closed` với DuplicateConnection/Kick chuyển sang `error` nhưng không báo builder/UI (inbox vẫn trông như đang kết nối).

## Unresolved Questions
- Chọn A (adapter Contact Scan) hay B (job import riêng)?
- Import nhóm thành **một contact đại diện nhóm** (như hiện tại, `group:<id>`) hay import cả **thành viên nhóm** thành contact riêng?
- Bật `selfListen` để mirror tin gửi từ điện thoại có nằm trong phạm vi không?
- Chưa xác minh chữ ký chính xác của `getAllFriends` trong `zca-js@2.3.0` (hook chặn đọc `node_modules`); cần kiểm tra trước khi code.
