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
