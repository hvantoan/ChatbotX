/**
 * CLI command-name derivation from {path, method}. Kept in the shared
 * catalog package so the CLI, its tests and any documentation tooling agree
 * on names; the MCP server does not use it (its names come from operationId).
 */

const POST_VERB_OVERRIDES: Record<string, string> = {
  message: "send",
}

// Sub-paths that are actions themselves (not nouns), collapse to group:action (2-level)
const ACTION_SUBPATHS = new Set(["block", "unblock", "reset", "reindex"])
// Singleton resources — GET on the collection returns a single object, use "get" not "list"
// One per workspace: `GET /v1/shopify` (and `/v1/woocommerce`) reads the
// connection, not a list.
const SINGLETON_RESOURCES = new Set([
  "workspaces",
  "response-sla",
  "shopify",
  "woocommerce",
])
// Two-segment singleton resources that have a read AND a write route on the
// same path (`GET`/`PATCH /v1/workspace/settings`): the method picks the verb,
// otherwise both would derive the same command name and one would be dropped.
const METHOD_VERBED_SINGLETON_PATHS = new Set([
  "workspace/settings",
  "messenger/templates/{id}",
  "products/meta-catalog",
  "ecommerce/settings",
])
// Collections under a resource that take both a list (GET) and a create (POST)
// on the same path, which the generic naming would collapse into one command.
const METHOD_VERBED_COLLECTION_PATHS = new Set(["products/imports"])
const SINGLETON_VERBS: Record<string, string> = {
  get: "get",
  delete: "delete",
  post: "create",
  put: "update",
  patch: "update",
}
const V1_PREFIX_RE = /^\/v1\//
const LEADING_SLASH_RE = /^\//

/**
 * Explicit names for operations the generic derivation below would collapse
 * onto a sibling's command. A collision silently drops one operation, and for
 * `DELETE .../custom-fields` it left `contacts custom-field delete` clearing
 * every custom field instead of one — so each colliding operation gets its own
 * unambiguous verb here. Keyed by `METHOD path`.
 */
const COMMAND_NAME_OVERRIDES: Readonly<Record<string, string>> = {
  "DELETE /v1/contacts/{identifier}/custom-fields":
    "contacts:clear-all-custom-fields",
  "PUT /v1/contacts/{identifier}/custom-fields/{idOrName}":
    "contacts:set-custom-field",
  "PUT /v1/bot-fields/{idOrName}": "bot-fields:set",
  "PATCH /v1/messenger-channels/{id}/settings":
    "messenger-channels:settings:edit",
  "PATCH /v1/instagram-channels/{id}/settings":
    "instagram-channels:settings:edit",
  "PATCH /v1/inboxes/{inboxId}/ai-handover/settings": "inboxes:settings:edit",
  "PATCH /v1/bot-fields/{idOrName}": "bot-fields:edit",
  // Same path as GET/PUT/DELETE `integrations:find-by-ai`; without this the
  // PATCH would be silently dropped as a duplicate command name.
  "PATCH /v1/integrations/ai/{provider}": "integrations:update-ai",
  "DELETE /v1/analytics/flows/{flowId}/stats": "analytics:reset-flow-stats",
  "POST /v1/decision-connections/{id}/test": "decision-connections:test",
  // Derives to `whatsapp-channels:sync:add`, the name of
  // `POST /v1/whatsapp-channels/{id}/templates/sync`; without this one of the
  // two would be silently dropped.
  "POST /v1/whatsapp-channels/{id}/routing-roles/sync":
    "whatsapp-channels:routing-roles:sync",
  "POST /v1/ads/campaigns": "ads:create-campaign",
  "POST /v1/ads/conversion-rules": "ads:create-conversion-rule",
  "PATCH /v1/ads/conversion-rules/{id}": "ads:update-conversion-rule",
  "DELETE /v1/ads/conversion-rules/{id}": "ads:delete-conversion-rule",
  "POST /v1/mini-apps/{id}/publish-whatsapp": "mini-apps:publish-whatsapp",
  "GET /v1/mini-apps/{id}/flow-json": "mini-apps:flow-json",
  "POST /v1/mini-apps/{id}/duplicate": "mini-apps:duplicate",
  "POST /v1/mini-apps/{id}/whatsapp-draft": "mini-apps:whatsapp-draft:push",
  "POST /v1/mini-apps/{id}/whatsapp-draft/publish":
    "mini-apps:whatsapp-draft:publish",
  "GET /v1/mini-apps/{id}/whatsapp-preview": "mini-apps:whatsapp-preview",
  // `GET /v1/master-agent/sessions/{sessionId}` otherwise derives to
  // `master-agent:find-by-sessions`; name both sides of the group explicitly.
  "POST /v1/master-agent/messages": "master-agent:send-message",
  "GET /v1/master-agent/sessions/{sessionId}": "master-agent:get-session",
  "GET /v1/conversations/{conversationId}/messages/{messageId}/flow-response":
    "conversations:flow-response:get",
  // Pipeline actions are verbs on the pipeline or item, not sub-resources to "add".
  "POST /v1/pipelines/{id}/duplicate": "pipelines:duplicate",
  "POST /v1/pipelines/{id}/stages/reorder": "pipelines:stages:reorder",
  "POST /v1/pipelines/{id}/items/{itemId}/move": "pipelines:item:move",
  "POST /v1/pipelines/{id}/items/{itemId}/transfer": "pipelines:item:transfer",
  "GET /v1/pipelines/{id}/stats": "pipelines:stats",
  "GET /v1/pipelines/{id}/stage-totals": "pipelines:stage-totals",
  // Template share/analytics/retry are verbs on the template or install.
  "GET /v1/templates/{id}/link": "templates:link",
  "PUT /v1/templates/{id}/share": "templates:share",
  "POST /v1/templates/{id}/share/rotate": "templates:rotate-share",
  "GET /v1/templates/{id}/analytics": "templates:analytics",
  "GET /v1/templates/{id}/installers": "templates:installers",
  "GET /v1/templates/{id}/installers/{installerId}/uninstall-preview":
    "templates:uninstall-preview",
  "POST /v1/templates/{id}/installers/{installerId}/uninstall":
    "templates:uninstall-installer",
  "GET /v1/template-installations/{id}/uninstall-preview":
    "template-installations:uninstall-preview",
  "POST /v1/template-installations/{id}/uninstall":
    "template-installations:uninstall",
  "POST /v1/template-installations/{id}/uninstall/cancel":
    "template-installations:cancel-uninstall",
  "POST /v1/template-installations/{id}/retry": "template-installations:retry",
  "POST /v1/template-installations/{id}/sync": "template-installations:sync",
  "GET /v1/template-installations/{id}/syncs": "template-installations:syncs",
  "GET /v1/template-installations/{id}/syncs/{syncId}":
    "template-installations:sync-detail",
  "POST /v1/template-installations/{id}/backups/{backupId}/restore":
    "template-installations:restore-backup",
  // Order status moves are verbs on the order, not sub-resources to "add".
  "POST /v1/orders/{id}/accept": "orders:accept",
  "POST /v1/orders/{id}/ship": "orders:ship",
  "POST /v1/orders/{id}/conclude": "orders:conclude",
  "POST /v1/orders/{id}/cancel": "orders:cancel",
  "GET /v1/marketing-messages/campaigns": "marketing-messages:list-campaigns",
  "POST /v1/marketing-messages/campaigns": "marketing-messages:create-campaign",
  "GET /v1/marketing-messages/campaigns/{id}":
    "marketing-messages:get-campaign",
  "PUT /v1/marketing-messages/campaigns/{id}":
    "marketing-messages:update-campaign",
  "DELETE /v1/marketing-messages/campaigns/{id}":
    "marketing-messages:delete-campaign",
  "GET /v1/marketing-messages/audiences": "marketing-messages:list-audiences",
  "POST /v1/marketing-messages/audiences": "marketing-messages:create-audience",
  "DELETE /v1/marketing-messages/audiences/{id}":
    "marketing-messages:delete-audience",
  // AI agent sales profile singleton & training actions
  "GET /v1/ai-agents/{id}/sales-profile": "ai-agents:sales-profile:get",
  "POST /v1/ai-agents/{id}/sales-profile/propose":
    "ai-agents:sales-profile:propose",
  "POST /v1/ai-agents/{id}/sales-profile/apply":
    "ai-agents:sales-profile:apply",
  "POST /v1/ai-agents/{id}/sales-profile/revert":
    "ai-agents:sales-profile:revert",
  "DELETE /v1/ai-agents/{id}/training-messages":
    "ai-agents:training-messages:clear",
}

export function pathAndMethodToCommandName(
  pathTemplate: string,
  method: string,
): string {
  const override =
    COMMAND_NAME_OVERRIDES[`${method.toUpperCase()} ${pathTemplate}`]
  if (override) {
    return override
  }
  const normalized = pathTemplate
    .replace(V1_PREFIX_RE, "")
    .replace(LEADING_SLASH_RE, "")
  const segments = normalized.split("/")
  const group = segments[0]
  const m = method.toLowerCase()

  if (segments.length === 1) {
    const actions: Record<string, string> = {
      get: SINGLETON_RESOURCES.has(group) ? "get" : "list",
      post: "create",
      put: "update",
      patch: "update",
      delete: "delete",
    }
    return `${group}:${actions[m] ?? m}`
  }

  const secondIsParam = segments[1].startsWith("{")

  if (!secondIsParam && METHOD_VERBED_SINGLETON_PATHS.has(normalized)) {
    const verb = segments[2] && m === "get" ? "get" : (SINGLETON_VERBS[m] ?? m)
    return `${group}:${segments[1]}:${verb}`
  }

  if (!secondIsParam && METHOD_VERBED_COLLECTION_PATHS.has(normalized)) {
    const verb = m === "get" ? "list" : (SINGLETON_VERBS[m] ?? m)
    return `${group}:${segments[1]}:${verb}`
  }

  if (!secondIsParam) {
    // Filter/variant on collection: /v1/integrations/status/token-errors or /v1/tags/name/{name}
    const nonParamTail = segments.slice(1).filter((s) => !s.startsWith("{"))
    const isLastParam = segments.at(-1)?.startsWith("{") ?? false
    const action = nonParamTail.join("-")
    return `${group}:${isLastParam ? `find-by-${action}` : action}`
  }

  const remainingAfterResource = segments.slice(2)

  if (remainingAfterResource.length === 0) {
    const actions: Record<string, string> = {
      get: "get",
      put: "update",
      patch: "update",
      delete: "delete",
      post: "create",
    }
    return `${group}:${actions[m] ?? m}`
  }

  const nonParamRemainder = remainingAfterResource.filter(
    (s) => !s.startsWith("{"),
  )
  const subResource = nonParamRemainder.at(-1)
  const isLastRemainderParam =
    remainingAfterResource.at(-1)?.startsWith("{") ?? false
  const singular = subResource?.endsWith("s")
    ? subResource.slice(0, -1)
    : subResource

  if (m === "get") {
    const sub = isLastRemainderParam ? singular : subResource
    const verb = isLastRemainderParam ? "get" : "list"
    return `${group}:${sub}:${verb}`
  }
  if (m === "post") {
    if (ACTION_SUBPATHS.has(subResource ?? "")) {
      return `${group}:${subResource}`
    }
    const verb = POST_VERB_OVERRIDES[singular ?? ""] ?? "add"
    return `${group}:${singular}:${verb}`
  }
  if (m === "delete") {
    return `${group}:${singular}:delete`
  }
  if (m === "put" || m === "patch") {
    return `${group}:${subResource}:update`
  }
  return `${group}:${subResource}:${m}`
}
