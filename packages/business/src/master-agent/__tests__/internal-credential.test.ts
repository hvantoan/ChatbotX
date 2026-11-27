import { describe, expect, test } from "vitest"
import {
  MASTER_AGENT_CREDENTIAL_TTL_SECONDS,
  mintMasterAgentCredential,
  verifyMasterAgentCredential,
} from "../internal-credential"

const TRAILING_EQUALS = /=+$/u

const SECRET = "test-secret-at-least-32-characters-long"
const NOW = 1_800_000_000_000

const mintInput = {
  workspaceId: "ws-1",
  memberId: "m-1",
  sessionId: "s-1",
  secret: SECRET,
  nowMs: NOW,
}

describe("master-agent internal credential", () => {
  test("a minted credential verifies back to its payload", async () => {
    const token = await mintMasterAgentCredential(mintInput)

    const payload = await verifyMasterAgentCredential(token, SECRET, NOW)

    expect(payload).toMatchObject({
      purpose: "master-agent",
      workspaceId: "ws-1",
      memberId: "m-1",
      sessionId: "s-1",
    })
    expect(payload?.exp).toBe(
      Math.floor(NOW / 1000) + MASTER_AGENT_CREDENTIAL_TTL_SECONDS,
    )
  })

  test("an expired credential is rejected", async () => {
    const token = await mintMasterAgentCredential(mintInput)
    const afterExpiry = NOW + (MASTER_AGENT_CREDENTIAL_TTL_SECONDS + 1) * 1000

    expect(
      await verifyMasterAgentCredential(token, SECRET, afterExpiry),
    ).toBeNull()
  })

  test("a credential signed with another secret is rejected", async () => {
    const token = await mintMasterAgentCredential(mintInput)

    expect(
      await verifyMasterAgentCredential(
        token,
        "wrong-secret-wrong-secret-wrong",
        NOW,
      ),
    ).toBeNull()
  })

  test("a tampered payload is rejected", async () => {
    const token = await mintMasterAgentCredential(mintInput)
    const [header, , signature] = token.split(".")
    const otherPayload = btoa(
      JSON.stringify({
        purpose: "master-agent",
        workspaceId: "ws-2",
        sessionId: "s-1",
        iat: Math.floor(NOW / 1000),
        exp: Math.floor(NOW / 1000) + 300,
      }),
    )
      .replaceAll("+", "-")
      .replaceAll("/", "_")
      .replace(TRAILING_EQUALS, "")
    const tampered = `${header}.${otherPayload}.${signature}`

    expect(await verifyMasterAgentCredential(tampered, SECRET, NOW)).toBeNull()
  })

  test("a well-formed token with another purpose is rejected", async () => {
    // Re-mint machinery: sign a purpose-other payload with the same secret,
    // the way a different feature's credential would look.
    const payloadSegment = btoa(
      JSON.stringify({
        purpose: "mobile",
        workspaceId: "ws-1",
        sessionId: "s-1",
        iat: Math.floor(NOW / 1000),
        exp: Math.floor(NOW / 1000) + 300,
      }),
    )
      .replaceAll("+", "-")
      .replaceAll("/", "_")
      .replace(TRAILING_EQUALS, "")
    const { hmacSha256Hex } = await import("@inboxos.io/utils/crypto")
    const unsigned = `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.${payloadSegment}`
    const signature = await hmacSha256Hex(SECRET, unsigned)

    expect(
      await verifyMasterAgentCredential(
        `${unsigned}.${signature}`,
        SECRET,
        NOW,
      ),
    ).toBeNull()
  })

  test("garbage input is rejected, never throws", async () => {
    expect(
      await verifyMasterAgentCredential("not-a-jwt", SECRET, NOW),
    ).toBeNull()
    expect(await verifyMasterAgentCredential("a.b.c", SECRET, NOW)).toBeNull()
    expect(await verifyMasterAgentCredential("", SECRET, NOW)).toBeNull()
  })

  test("a token-turn credential carries the token id instead of a member", async () => {
    const token = await mintMasterAgentCredential({
      workspaceId: "ws-1",
      tokenId: "tok-1",
      sessionId: "s-1",
      secret: SECRET,
      nowMs: NOW,
    })

    const payload = await verifyMasterAgentCredential(token, SECRET, NOW)

    expect(payload?.tokenId).toBe("tok-1")
    expect(payload?.memberId).toBeUndefined()
  })
})
