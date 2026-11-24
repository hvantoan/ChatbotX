# AI Agent Sales Persona and Goal (Taught by Chat)

An AI Agent can be configured with a structured **sales profile** (`AIAgent.salesProfile`) that defines its sales persona, tone, primary objective, prioritized target products from the workspace product catalog, forbidden topics, and automatic human handover rules.

Administrators can teach the agent through a natural-language **Sales Training** chat in the builder (or via the public API, CLI, and MCP) or edit the structured fields directly.

---

## 1. Data Model

### `AIAgent` columns
- `salesProfile` (`jsonb`, nullable): Active `AIAgentSalesProfile` configuration.
- `salesProfileVersion` (`integer`, not null, default `0`): Monotonically increasing version counter (`0` when no profile has been saved).

### `AIAgentSalesProfile` shape
```ts
type AIAgentSalesTargetProduct = {
  productId: string       // Active Product.id in the same workspace
  priority: number        // 1..10 (1 = highest priority, pitched first)
  pitchNote?: string      // Optional guidance (max 500 chars)
}

type AIAgentSalesProfile = {
  enabled: boolean
  tone: string            // Max 1000 chars (e.g. pronouns, politeness)
  role: string            // Max 500 chars
  objective: string       // Max 1000 chars
  targetProducts: AIAgentSalesTargetProduct[] // Max 10
  forbiddenTopics: string[]                   // Max 20, each max 200 chars
  offTopicLimit: number                       // 1..10, default 3
  handoverOnHumanRequest: boolean             // Default true
  handoffMessage: string                      // Max 500 chars, default "Anh/chị đợi em một chút, em làm thủ tục đăng ký ạ"
  handoffTriggers: string                     // Max 1000 chars, natural-language conditions for advisor handover
}
```

> **Single source of truth for prices:** `AIAgentSalesProfile` deliberately contains **no** price, discount, or currency fields. All product names, prices, discounts, currencies, URLs, and enabled variant prices are read live from the workspace's `Product` and `ProductVariant` rows at runtime.

### `AIAgentSalesProfileVersion` table
Immutable version history for every change to an agent's sales profile:
- `workspaceId`, `aiAgentId`, `version` (unique per `(aiAgentId, version)`)
- `profile` (`jsonb`)
- `source` (`"manual" | "proposal" | "revert"`)
- `instruction` (`text`, nullable): The natural-language instruction (for `proposal`) or `"Revert to v{N}"` (for `revert`).
- `createdById` (`bigint`, nullable, `ON DELETE SET NULL`)

### `AIAgentTrainingMessage` table
Persisted chat history for the Sales Training tab:
- `workspaceId`, `aiAgentId`
- `role` (`"admin" | "assistant"`)
- `content` (`text`)
- `proposal` (`jsonb`, nullable): `{ proposedProfile, diff, clarifyingQuestion?, unmatchedProducts? }`
- `appliedVersion` (`integer`, nullable): Set to the new version number when the administrator clicks **Apply** on that proposal card.
- `createdById` (`bigint`, nullable, `ON DELETE SET NULL`)

Both `AIAgentSalesProfileVersion` and `AIAgentTrainingMessage` are registered in `HEAVY_WORKSPACE_TABLES` with leading `workspaceId` and `aiAgentId` indexes so workspace purge drains them in bounded batches before parent deletion.

---

## 2. Chat-Based Training (`Propose` → `Apply` → `Revert`)

1. **Propose (`POST /v1/ai-agents/{id}/sales-profile/propose`):**
   - Takes `{ instruction }` (1–4000 chars).
   - Rate-limited per workspace (5 requests per 10 seconds) and enforces the workspace owner's bot message quota.
   - Loads the active profile, up to 50 active products from the workspace catalog, and the last 20 training messages.
   - Calls the agent's first configured AI provider (`@chatbotx.io/ai/sales-profile-proposer`) with `Output.object()` (`temperature: 0`) to produce a structured patch.
   - Never trusts the LLM output blindly: merges the patch with the current profile, validates with `aiAgentSalesProfileSchema`, verifies every `productId` belongs to the workspace and is `active`, computes a field-by-field diff, and appends the `admin` + `assistant` messages to `AIAgentTrainingMessage`.
   - Does **not** mutate `AIAgent.salesProfile`.
2. **Apply (`POST /v1/ai-agents/{id}/sales-profile/apply`):**
   - Takes `{ profile, instruction?, messageId? }`.
   - Re-validates the full profile and product ownership server-side inside a transaction locking the `AIAgent` row (`FOR UPDATE`), increments `salesProfileVersion` to `N + 1`, inserts an `AIAgentSalesProfileVersion` row (`source: "proposal"`), marks `messageId` with `appliedVersion = N + 1`, and invalidates the workspace AI agent cache.
3. **Revert (`POST /v1/ai-agents/{id}/sales-profile/revert`):**
   - Takes `{ version }`.
   - Looks up the historical version snapshot, re-validates its target products, and writes a new version `N + 1` with `source: "revert"` and `instruction: "Revert to v{version}"`. History is append-only.

---

## 3. Runtime Prompt Order & Per-Conversation Sales State

When `aiAgent.salesProfile?.enabled` is `true`, `runAIReply` (`apps/worker/src/integration/handlers/automated-response/replies.ts`) loads the active target products with `productService.findForSalesProfile` and prepends `compileSalesPrompt({ profile, products, salesState })` before the agent's base prompt in four fixed sections:

1. **`[1. VAI TRÒ & GIỌNG ĐIỆU]`**: Role and tone (`"Bạn là {role}. Giọng điệu: {tone}"`).
2. **`[2. MỤC TIÊU & SẢN PHẨM MỤC TIÊU]`**: Primary objective and active target products sorted by `priority` ascending, with live `price`, `discount`, `currency`, `productUrl`, enabled `variants`, and `pitchNote`. Inactive or deleted products are omitted.
3. **`[3. QUY TẮC BẮT BUỘC]`**:
   - Pitch priority-1 product first unless the customer named another product.
   - If the customer named another product, serve that product and mention priority 1 at most once.
   - Never invent a price, discount, or promotion not listed in section 2.
   - Answer off-topic questions in at most one sentence and steer back to the sales objective.
   - Forbidden topics, natural waiting message (`handoffMessage`) when matching `handoffTriggers`, and strict role/instruction confidentiality (never use words like `"bot"`, `"AI"`, `"trợ lý ảo"`, `"human agent"`).
4. **`[4. TRẠNG THÁI HỘI THOẠI HIỆN TẠI]`**: Current `stage`, `pitchedProductIds`, and `offTopicStreak / offTopicLimit`.

When `salesProfile.enabled` is `true`, `appendHandoffPolicy` also replaces the generic `aiPolicies.handoff` with a sales-specific handoff policy (`buildSalesHandoffPolicy`) that transfers according to `handoffTriggers`, replies with `handoffMessage`, and forbids `"human agent"`, `"bot"`, `"AI"`, and `"trợ lý ảo"`. Agents without an enabled sales profile keep `aiPolicies.handoff` unchanged.

### Conversation Sales State (`Conversation.additionalAttributes.salesState`)
```ts
type ConversationSalesState = {
  stage: "discover" | "pitch" | "objection" | "alternative" | "close"
  pitchedProductIds: string[]
  offTopicStreak: number
  profileVersion: number
}
```
- Updated via `conversationService.updateSalesState`, which uses `jsonb_set(COALESCE(additionalAttributes, '{}'::jsonb), '{salesState}', ...)` scoped by `workspaceId` and `conversationId` so sibling keys like `challenge` are never overwritten.
- Automatically resets to `{ stage: "discover", pitchedProductIds: [], offTopicStreak: 0, profileVersion: aiAgent.salesProfileVersion }` whenever `salesState.profileVersion !== aiAgent.salesProfileVersion`.

---

## 4. Buffering Trade-Off & Two-Tier Reply Guard

### Buffered vs. Streaming Mode
- **Agents without an enabled sales profile (`salesProfile.enabled !== true`):** Stream reply chunks immediately (`processStreamingText(..., { sendParts: true })`) with zero added latency.
- **Agents with `salesProfile.enabled === true`:** Buffer the candidate reply (`{ sendParts: false }`) and run `evaluateSalesGuard` (`apps/worker/src/integration/handlers/automated-response/sales-guard.ts`) before sending any message to the customer. Rich-mode replies (`handleRichAIReply`) extract text from cards/buttons and run the same guard before enqueuing rich messages.

### Tier 1: Deterministic Price & Percentage Verifier (No Model Call)
- Extracts money-like numbers and percentages from the candidate reply (supporting VND and USD notations: `2.500.000đ`, `1,990,000`, `1tr99`, `1.5 triệu`, `500k`, `$49`, `20%`).
- Compares every extracted token against the allowed set built from the active target products and their enabled variants (`price`, `price - discount`, `discount` amount, and discount percentage) with a `±0.5%` rounding tolerance.
- Any unmatched money or percentage token fails Tier 1 with `invented_price`.

### Tier 2: Structured Model Judge
- Uses the agent's own configured model with `maxOutputTokens: 150`, `temperature: 0`, and a dedicated 4-second deadline (`TIER2_JUDGE_TIMEOUT_MS`).
- Returns `{ onTopic, inRole, customerAskedForHuman, stage, mentionedProductIds }`.
- **Fail-open resilience:** If Tier 2 times out or errors, it logs a warning (`{ err }`) and fails open to Tier 1 so the customer still receives a reply.

### Decision, Single Rewrite, Fallback, and Handover
1. **Immediate Human Handover:** If `customerAskedForHuman && profile.handoverOnHumanRequest` (including when the customer asks `"bot à?"` / `"có phải người thật không?"`), sends `profile.handoffMessage` (default `"Anh/chị đợi em một chút, em làm thủ tục đăng ký ạ"`) **before** calling `handoffExecutorService.execute` with reason `"sales_profile_human_request"`.
2. **At Most One Rewrite:** If Tier 1 fails (`invented_price`), the reply self-identifies as AI/bot (`containsBotSelfDisclosure`), or Tier 2 reports `!inRole` or `!onTopic`, makes **one** rewrite call with the violation feedback and re-checks Tier 1 and bot self-disclosure on the rewritten text.
3. **Fixed Fallback:** If the rewritten text still fails Tier 1 or contains bot self-disclosure (or rewrite fails), sends a deterministic fallback line built from the profile and priority-1 product (`buildSalesFallbackReply`) in the `"em"` voice with zero bot-revealing terms.
4. **State Update & Off-Topic Streak Handover:** Updates `offTopicStreak = onTopic ? 0 : offTopicStreak + 1`, `stage`, and `pitchedProductIds`. When `offTopicStreak >= profile.offTopicLimit`, sends `profile.handoffMessage` **before** calling `handoffExecutorService.execute` with reason `"sales_profile_off_topic"`.
5. **Analytics:** Emits `analytics:dashboard` (`message:bot_received`) with `metadata.salesGuardOutcome` (`"passed" | "rewritten" | "fallback" | "handoff"`).

---

## 5. Templates, Public API, CLI, and MCP

### Template Packaging & Installation
- `aiAgentsAdapter` includes `salesProfile` in the template snapshot and locks `salesProfile` in `TEMPLATE_LOCKED_CONTENT_KEYS.aiAgent`.
- Version history and training chat messages are **not** copied into templates; an installed agent with a `salesProfile` starts at `salesProfileVersion = 1` (`source: "manual"`).
- `salesProfile.targetProducts[].productId` references are remapped through `ctx.idMaps.product`. Unmapped products are dropped with a warning (`entityKind: "product"`). If all target products were dropped, the installed profile is automatically set to `enabled: false` with a warning.

### Public API Endpoints (Scope `automation`)
| Method | Path | Summary |
| --- | --- | --- |
| `GET` | `/v1/ai-agents/{id}/sales-profile` | Get AI agent sales profile |
| `PUT` | `/v1/ai-agents/{id}/sales-profile` | Update AI agent sales profile (`source: manual`) |
| `POST` | `/v1/ai-agents/{id}/sales-profile/propose` | Propose AI agent sales profile change |
| `POST` | `/v1/ai-agents/{id}/sales-profile/apply` | Apply AI agent sales profile proposal (`source: proposal`) |
| `GET` | `/v1/ai-agents/{id}/sales-profile/versions` | List AI agent sales profile versions |
| `POST` | `/v1/ai-agents/{id}/sales-profile/revert` | Revert AI agent sales profile (`source: revert`) |
| `GET` | `/v1/ai-agents/{id}/training-messages` | List AI agent training messages |
| `DELETE` | `/v1/ai-agents/{id}/training-messages` | Clear AI agent training messages |

### CLI Commands
```bash
chatbotx ai-agents sales-profile get <id>
chatbotx ai-agents sales-profile update <id> --profile <json>
chatbotx ai-agents sales-profile propose <id> --instruction <text>
chatbotx ai-agents sales-profile apply <id> --profile <json> [--instruction <text> --messageId <id>]
chatbotx ai-agents versions list <id> [--cursor --limit]
chatbotx ai-agents sales-profile revert <id> --version <n>
chatbotx ai-agents training-messages list <id> [--cursor --limit]
chatbotx ai-agents training-messages clear <id>
```

---

## 6. Runbook: Bật lại Bot sau khi Tư vấn viên xử lý xong (Manual Bot Re-enable)

Khi guard hoặc tool chuyển giao hội thoại sang tư vấn viên (`handoffExecutorService.execute`), hệ thống tự động:
1. Gửi câu chờ `handoffMessage` cho khách hàng (ví dụ: `"Anh/chị đợi em một chút, em làm thủ tục đăng ký ạ"`).
2. Tắt bot trên hội thoại đó (`Conversation.botEnabled = false`) và phát sự kiện `conversationTransferredToHuman`.
3. Trigger `conversationTransferredToHuman` → `assignConversation` gán hội thoại cho tư vấn viên phụ trách và gửi push notification (nếu tư vấn viên đang trong ca làm việc / không bị chặn bởi Working Hours).

Sau khi tư vấn viên hỗ trợ khách xong (hoặc khách quay lại hỏi thông tin chung và tư vấn viên muốn AI tiếp tục trả lời tự động), tư vấn viên cần **bật lại bot bằng tay** theo một trong hai cách sau:

### Cách 1: Trên giao diện Inbox (Web / Mobile App)
1. Mở hội thoại của khách hàng trong mục **Inbox**.
2. Ở thanh công cụ góc trên bên phải của khung chat (hoặc panel thông tin hội thoại), bật công tắc **Bot** (`Enable Bot` / biểu tượng robot) từ trạng thái **Tắt** sang **Bật** (`botEnabled = true`).
3. (Tuỳ chọn) Nếu muốn gỡ phân công để hội thoại trở về hàng đợi chung, bấm **Unassign**.

### Cách 2: Qua Public API / CLI
- **Public API:** Gọi `POST /v1/conversations/{id}/bot-status` (hoặc endpoint cập nhật trạng thái bot của hội thoại) với `{ "botEnabled": true }`.
- **Lưu ý vận hành:** Nếu tư vấn viên quên bật lại công tắc Bot sau khi kết thúc hỗ trợ, các tin nhắn tiếp theo của khách trong hội thoại đó sẽ không kích hoạt AI trả lời tự động cho đến khi `botEnabled` được bật lại hoặc hết thời gian tạm dừng (`botResumeAt`).
