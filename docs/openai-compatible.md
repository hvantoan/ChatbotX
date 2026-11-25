# OpenAI-Compatible AI Providers

Workspace integrations with OpenAI-compatible endpoints (LM Studio, Ollama, NVIDIA NIM, Clarifai, NEAR AI, or custom endpoints) allow multiple configurations per workspace.

## Agent / Public API Lifecycle

1. **Connect:** `POST /v1/connections` (`connections.create`) with `provider: "openaiCompatible"` and `config: { baseURL, apiKey, name?, preset?, defaultModel?, autoReply?, enabled? }`.
2. **Resolve satellite `id`:** `GET /v1/integrations/ai/openaiCompatible` (`integrations.getAiProvider` with `provider: "openaiCompatible"`, optionally filtered by `?integrationId=...`).
   - Each entry returns:
     - `id`: the satellite `IntegrationOpenaiCompatible.id` — pass this as `integrationId` to `aiAgents.create` / `aiAgents.update` and `integrations.updateAiProvider`.
     - `integrationId`: the parent `Integration.id` matching `connection.integrationId`.
   - Both `id` and `integrationId` are accepted by `integrations.getAiProvider` and `integrations.updateAiProvider`, while `aiAgents.create` specifically requires the satellite `id`.
3. **Update settings / toggle `autoReply`:** `PATCH /v1/integrations/ai/openaiCompatible` (`integrations.updateAiProvider`) with `integrationId` and any subset of `autoReply`, `enabled`, `name`, `preset`, `defaultModel`, `baseURL`, `apiKey`.
   - Changing `baseURL` to a different origin requires providing `apiKey` (prevents forwarding a stored secret to an unverified host).
   - Both the builder UI (`updateOpenaiCompatibleAction`) and the public API call `integrationOpenaiCompatibleService.updateWithVerification`.
4. **Disconnect:** `DELETE /v1/connections/{id}` (`connections.disconnect`).

## Embeddings (AI Files)

AI File embeddings resolve through `resolveEmbeddingModel()`, which tries `openai` → `gemini` → the first **enabled** `openaiCompatible` integration (`orderBy createdAt asc`). The `autoReply` flag does not apply here: any enabled OpenAI-compatible connection is usable for embeddings.

Choose the embedding model id with:

```env
OPENAI_COMPATIBLE_EMBEDDING_MODEL=text-embedding-3-small
```

- Unset → defaults to `text-embedding-3-small`. The model id is never hardcoded to a gateway-specific value.
- Set it in the root `.env` (the worker scripts load it via `dotenv -e ../../.env`) and in `apps/builder/.env` when the builder dev server needs it. `scripts/dev-up.sh` only ensures a handful of keys, so add this one manually.

Constraints:

- **1536 dimensions.** `AIEmbedding.embedding` (`packages/database/src/schema/ai-embedding.ts`) and `AIConversationEmbedding.embedding` (`packages/database/src/schema/ai-conversation-embedding.ts`) are fixed `vector(1536)`. The gateway model must return 1536 values (`text-embedding-3-small`, `text-embedding-ada-002`); any other width fails on insert and leaves the file unindexed.
- **The endpoint must relay `POST /v1/embeddings`.** Some gateways serve chat completions but not embeddings (OpenRouter and the `opencode-go` preset do not relay embeddings), so the connection resolves and then every embed call fails. Use a gateway with an embeddings-capable provider credential (e.g. 9router configured with the right upstream provider).

## SSRF Guard & Self-Hosted Opt-Out

- SSRF validation (`validateOpenaiCompatibleBaseUrlForEnvironment`) is **enabled by default on every edition** (cloud, enterprise, and community). Private, loopback (`127.0.0.1`, `::1`), and link-local (`169.254.169.254`) endpoints are rejected with HTTP `400 ssrfBlocked` on both `POST /v1/connections` (`connections.create`) and `PATCH /v1/integrations/ai/openaiCompatible`; the public message never carries the internal `(code …)` suffix.
- On the builder connect/update forms, an endpoint that cannot be reached (timeout, connection error, or an unexpected non-auth HTTP response from `/models`) is reported separately as `providerUnreachable`, distinct from `invalidBaseURL` (malformed URL or SSRF-blocked). The public API keeps `invalidBaseUrl` as its code for an unreachable endpoint.
- Self-hosted deployments that intentionally connect to local or LAN inference servers (e.g. LM Studio or Ollama on `127.0.0.1` or private IPs) can opt out by setting:

  ```env
  OPENAI_COMPATIBLE_ALLOW_PRIVATE_URLS=true
  ```

- When `NEXT_PUBLIC_EDITION=cloud`, `OPENAI_COMPATIBLE_ALLOW_PRIVATE_URLS` is **always ignored**.

### Upgrade Note (Self-Hosted)

If you are upgrading an existing self-hosted deployment that already connects to local or LAN endpoints — including the default `lmstudio` preset (`http://127.0.0.1:1234/v1`), Ollama, or any private IP — set `OPENAI_COMPATIBLE_ALLOW_PRIVATE_URLS=true` before or immediately after upgrading.

Without this opt-out after upgrading:

- Connection health checks (`verify`) will report existing local/LAN endpoints as blocked by the SSRF guard.
- Any UI edit or `PATCH` with `baseURL` on those providers will fail with `ssrfBlocked`.
- Runtime chat/AI execution (`packages/ai`) is not gated by this check and will continue working, but connection management and health status will report failures until the opt-out is enabled.

## Disconnect Reference Risk

Disconnecting an `openaiCompatible` connection (`connections.disconnect` or UI disconnect) does **not** run a reference-guard check against existing AI agents or flow steps. If an AI agent or flow step still references a disconnected satellite `id`, it will fail at runtime until updated to another active model/integration.
