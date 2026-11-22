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

- SSRF validation (`validateOpenaiCompatibleBaseUrlForEnvironment`) is **enabled by default on every edition** (cloud, enterprise, and community). Private, loopback (`127.0.0.1`, `::1`), and link-local (`169.254.169.254`) endpoints return HTTP `400` (`ssrfBlocked`).
- Self-hosted deployments that intentionally connect to local or LAN inference servers (e.g. LM Studio or Ollama on `127.0.0.1` or private IPs) can opt out by setting:

  ```env
  OPENAI_COMPATIBLE_ALLOW_PRIVATE_URLS=true
  ```

- When `NEXT_PUBLIC_EDITION=cloud`, `OPENAI_COMPATIBLE_ALLOW_PRIVATE_URLS` is **always ignored**.

## Disconnect Reference Risk

Disconnecting an `openaiCompatible` connection (`connections.disconnect` or UI disconnect) does **not** run a reference-guard check against existing AI agents or flow steps. If an AI agent or flow step still references a disconnected satellite `id`, it will fail at runtime until updated to another active model/integration.
