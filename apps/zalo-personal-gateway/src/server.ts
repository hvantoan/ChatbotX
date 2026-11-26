import http, { type IncomingMessage, type ServerResponse } from "node:http"
import { timingSafeStringEqual } from "@inboxos.io/utils/crypto"
import { z } from "zod"
import { logger } from "./logger"
import type { QrSessionManager } from "./qr-manager"
import {
  SessionNotConnectedError,
  type ZaloSessionManager,
} from "./session-manager"

const ACCOUNT_STATUS_PATH_RE = /^\/accounts\/([^/]+)\/status$/
const ACCOUNT_SYNC_PATH_RE = /^\/accounts\/([^/]+)\/sync$/
const ACCOUNT_FRIENDS_PATH_RE = /^\/accounts\/([^/]+)\/friends$/

const startQrSchema = z.object({
  proxyUrl: z.string().url().optional(),
})

const credentialsSchema = z.object({
  imei: z.string().min(1),
  cookie: z.union([
    z.array(z.unknown()),
    z.object({
      url: z.string(),
      cookies: z.array(z.unknown()),
    }),
  ]),
  userAgent: z.string().min(1),
})

const startAccountSchema = z.object({
  integrationId: z.string().min(1),
  zaloUid: z.string().min(1),
  credentials: credentialsSchema,
  proxyUrl: z.string().url().optional(),
  webhookUrl: z.string().url(),
  webhookSecret: z.string().min(16).optional(),
})

const stopAccountSchema = z.object({
  zaloUid: z.string().min(1),
})

const verifyAccountSchema = z.object({
  credentials: credentialsSchema,
  proxyUrl: z.string().url().optional(),
})

const sendMessageSchema = z.object({
  zaloUid: z.string().min(1),
  threadId: z.string().min(1),
  threadType: z.enum(["user", "group"]),
  text: z.string().optional(),
  attachments: z
    .array(
      z.object({
        url: z.string().url(),
        filename: z.string().min(1),
        fileType: z.enum(["image", "video", "audio", "file"]),
      }),
    )
    .optional(),
})

function sendJson(
  res: ServerResponse,
  statusCode: number,
  body: unknown,
): void {
  const payload = JSON.stringify(body)
  res.writeHead(statusCode, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(payload),
  })
  res.end(payload)
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  let totalBytes = 0
  const maxBytes = 1024 * 1024 // 1 MB

  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    totalBytes += buf.byteLength
    if (totalBytes > maxBytes) {
      throw new Error("Request body too large")
    }
    chunks.push(buf)
  }

  const raw = Buffer.concat(chunks).toString("utf8")
  if (!raw) {
    return {}
  }
  return JSON.parse(raw) as unknown
}

function isAuthorized(req: IncomingMessage, token: string): boolean {
  const authHeader = req.headers.authorization
  if (authHeader?.startsWith("Bearer ")) {
    const presented = authHeader.slice("Bearer ".length)
    return timingSafeStringEqual(presented, token)
  }
  const customHeader = req.headers["x-gateway-token"]
  if (typeof customHeader === "string") {
    return timingSafeStringEqual(customHeader, token)
  }
  return false
}

export type GatewayServerDeps = {
  token: string
  qrManager: Pick<QrSessionManager, "startSession" | "getStatus">
  sessionManager: Pick<
    ZaloSessionManager,
    | "getActiveCount"
    | "getStatus"
    | "startAccount"
    | "stopAccount"
    | "syncHistory"
    | "listFriends"
    | "verifyCredentials"
    | "sendMessage"
  >
}

export function createGatewayServer(deps: GatewayServerDeps): http.Server {
  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://localhost")
      const pathname = url.pathname

      if (req.method === "GET" && pathname === "/health") {
        sendJson(res, 200, {
          ok: true,
          activeSessions: deps.sessionManager.getActiveCount(),
        })
        return
      }

      if (!isAuthorized(req, deps.token)) {
        sendJson(res, 401, { error: "Unauthorized" })
        return
      }

      if (req.method === "POST" && pathname === "/qr/start") {
        const body = startQrSchema.parse(await readJsonBody(req))
        const result = await deps.qrManager.startSession(body.proxyUrl)
        sendJson(res, 200, result)
        return
      }

      if (req.method === "GET" && pathname === "/qr/status") {
        const sessionId = url.searchParams.get("sessionId")
        if (!sessionId) {
          sendJson(res, 400, { error: "Missing sessionId query parameter" })
          return
        }
        const status = deps.qrManager.getStatus(sessionId)
        if (!status) {
          sendJson(res, 404, { error: "QR session not found" })
          return
        }
        sendJson(res, 200, status)
        return
      }

      if (req.method === "POST" && pathname === "/accounts/verify") {
        const body = verifyAccountSchema.parse(await readJsonBody(req))
        const result = await deps.sessionManager.verifyCredentials(
          body.credentials as Parameters<
            ZaloSessionManager["verifyCredentials"]
          >[0],
          body.proxyUrl,
        )
        sendJson(res, 200, result)
        return
      }

      if (req.method === "POST" && pathname === "/accounts/start") {
        const body = startAccountSchema.parse(await readJsonBody(req))
        const result = await deps.sessionManager.startAccount({
          integrationId: body.integrationId,
          zaloUid: body.zaloUid,
          credentials: body.credentials as Parameters<
            ZaloSessionManager["startAccount"]
          >[0]["credentials"],
          proxyUrl: body.proxyUrl,
          webhookUrl: body.webhookUrl,
          webhookSecret: body.webhookSecret,
        })
        sendJson(res, 200, result)
        return
      }

      if (req.method === "POST" && pathname === "/accounts/stop") {
        const body = stopAccountSchema.parse(await readJsonBody(req))
        await deps.sessionManager.stopAccount(body.zaloUid)
        sendJson(res, 200, { ok: true })
        return
      }

      const statusMatch = ACCOUNT_STATUS_PATH_RE.exec(pathname)
      if (req.method === "GET" && statusMatch) {
        const zaloUid = decodeURIComponent(statusMatch[1])
        sendJson(res, 200, deps.sessionManager.getStatus(zaloUid))
        return
      }

      const syncMatch = ACCOUNT_SYNC_PATH_RE.exec(pathname)
      if (req.method === "POST" && syncMatch) {
        const zaloUid = decodeURIComponent(syncMatch[1])
        const result = await deps.sessionManager.syncHistory(zaloUid)
        sendJson(res, 200, result)
        return
      }

      const friendsMatch = ACCOUNT_FRIENDS_PATH_RE.exec(pathname)
      if (req.method === "GET" && friendsMatch) {
        const zaloUid = decodeURIComponent(friendsMatch[1])
        const friends = await deps.sessionManager.listFriends(zaloUid)
        sendJson(res, 200, { friends })
        return
      }

      if (req.method === "POST" && pathname === "/messages/send") {
        const body = sendMessageSchema.parse(await readJsonBody(req))
        const result = await deps.sessionManager.sendMessage(body)
        sendJson(res, 200, result)
        return
      }

      sendJson(res, 404, { error: "Not found" })
    } catch (err) {
      if (err instanceof z.ZodError) {
        sendJson(res, 400, {
          error: "Validation error",
          details: err.issues,
        })
        return
      }
      if (err instanceof SessionNotConnectedError) {
        sendJson(res, 409, {
          error: err.message,
          code: "session_not_connected",
        })
        return
      }
      logger.error({ err }, "Gateway HTTP request failed")
      sendJson(res, 500, { error: "Internal error" })
    }
  })
}
