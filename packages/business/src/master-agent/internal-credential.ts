import { hmacSha256Hex, timingSafeStringEqual } from "@inboxos.io/utils/crypto"

/**
 * The short-lived credential a Master Agent turn (or a pending-action
 * confirmation) uses to call the public API over HTTP. It is a HS256
 * JSON-web-token-shaped string signed with the deployment's server secret
 * (`BETTER_AUTH_SECRET`, the same secret every other server-side token uses),
 * never stored in the database and never backed by a real `WorkspaceApiToken`
 * row — five minutes after minting it is worthless.
 *
 * Web Crypto only, no `node:crypto`: the verifier runs inside the builder's
 * router graph (`workspaceTokenAuthMidddleware`), which Next.js also compiles
 * for the Edge runtime (invariant 25).
 */

export const MASTER_AGENT_CREDENTIAL_PURPOSE = "master-agent"
export const MASTER_AGENT_CREDENTIAL_TTL_SECONDS = 5 * 60

/** Type prefix of the bearer token, the way `sk_` marks a Stripe key. */
export const MASTER_AGENT_CREDENTIAL_PREFIX = "ma_"

export type MasterAgentCredentialPayload = {
  /** `master-agent` — anything else is not one of these credentials. */
  purpose: typeof MASTER_AGENT_CREDENTIAL_PURPOSE
  workspaceId: string
  /** Present when the turn was started by (or the action confirmed by) a member. */
  memberId?: string
  /** Present when the turn was started by a workspace API token. */
  tokenId?: string
  sessionId: string
  iat: number
  exp: number
}

const TRAILING_EQUALS_PATTERN = /=+$/u

const base64UrlEncodeBytes = (bytes: Uint8Array): string => {
  let binary = ""
  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(TRAILING_EQUALS_PATTERN, "")
}

const base64UrlEncode = (value: string): string =>
  base64UrlEncodeBytes(new TextEncoder().encode(value))

const base64UrlDecode = (value: string): string => {
  const base64 = value.replaceAll("-", "+").replaceAll("_", "/")
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return new TextDecoder().decode(bytes)
}

const JWT_HEADER = base64UrlEncode(JSON.stringify({ alg: "HS256", typ: "JWT" }))

const resolveSecret = (secret?: string): string => {
  const resolved = secret ?? process.env.BETTER_AUTH_SECRET
  if (!resolved) {
    throw new Error("BETTER_AUTH_SECRET is required")
  }
  return resolved
}

/**
 * Mints the credential. Exactly one of `memberId`/`tokenId` should be set —
 * member turns act with the member's permissions, token turns with the
 * token's scopes.
 */
export const mintMasterAgentCredential = async (input: {
  workspaceId: string
  memberId?: string
  tokenId?: string
  sessionId: string
  ttlSeconds?: number
  secret?: string
  nowMs?: number
}): Promise<string> => {
  const nowSeconds = Math.floor((input.nowMs ?? Date.now()) / 1000)
  const payload: MasterAgentCredentialPayload = {
    purpose: MASTER_AGENT_CREDENTIAL_PURPOSE,
    workspaceId: input.workspaceId,
    ...(input.memberId ? { memberId: input.memberId } : {}),
    ...(input.tokenId ? { tokenId: input.tokenId } : {}),
    sessionId: input.sessionId,
    iat: nowSeconds,
    exp: nowSeconds + (input.ttlSeconds ?? MASTER_AGENT_CREDENTIAL_TTL_SECONDS),
  }
  const encodedPayload = base64UrlEncode(JSON.stringify(payload))
  const unsigned = `${JWT_HEADER}.${encodedPayload}`
  const signature = await hmacSha256Hex(resolveSecret(input.secret), unsigned)
  // The `ma_` prefix is what lets the auth middleware tell "an expired or
  // tampered master-agent credential" (a hard 401) apart from "some other
  // JWT" (fall through to the next auth branch): a prefixed token must never
  // silently degrade into an API-token lookup.
  return `${MASTER_AGENT_CREDENTIAL_PREFIX}${unsigned}.${signature}`
}

/**
 * Verifies signature, expiry and purpose. Returns `null` for anything that is
 * not a valid master-agent credential — including a well-formed token whose
 * purpose differs — so the caller can fall through to the next auth branch.
 */
export const verifyMasterAgentCredential = async (
  token: string,
  secret?: string,
  nowMs?: number,
): Promise<MasterAgentCredentialPayload | null> => {
  if (!token.startsWith(MASTER_AGENT_CREDENTIAL_PREFIX)) {
    return null
  }
  const segments = token.slice(MASTER_AGENT_CREDENTIAL_PREFIX.length).split(".")
  if (segments.length !== 3) {
    return null
  }
  const [header, payloadSegment, signature] = segments
  if (!(header && payloadSegment && signature)) {
    return null
  }

  let resolvedSecret: string
  try {
    resolvedSecret = resolveSecret(secret)
  } catch {
    return null
  }

  const unsigned = `${header}.${payloadSegment}`
  const expected = await hmacSha256Hex(resolvedSecret, unsigned)
  if (!timingSafeStringEqual(signature, expected)) {
    return null
  }

  let payload: MasterAgentCredentialPayload
  try {
    payload = JSON.parse(
      base64UrlDecode(payloadSegment),
    ) as MasterAgentCredentialPayload
  } catch {
    return null
  }

  if (payload.purpose !== MASTER_AGENT_CREDENTIAL_PURPOSE) {
    return null
  }
  if (
    typeof payload.workspaceId !== "string" ||
    typeof payload.sessionId !== "string" ||
    typeof payload.exp !== "number"
  ) {
    return null
  }
  if (payload.exp * 1000 <= (nowMs ?? Date.now())) {
    return null
  }
  return payload
}

/**
 * Cheap shape check before paying for an HMAC: three segments whose middle
 * decodes to JSON with the master-agent purpose. The middleware uses it to
 * avoid HMAC-ing every OAuth JWT that passes through.
 */
export const isMasterAgentCredentialCandidate = (token: string): boolean => {
  const segments = token.split(".")
  if (segments.length !== 3) {
    return false
  }
  try {
    const payload = JSON.parse(base64UrlDecode(segments[1])) as {
      purpose?: unknown
    }
    return payload.purpose === MASTER_AGENT_CREDENTIAL_PURPOSE
  } catch {
    return false
  }
}
