import { randomUUID } from "node:crypto"
import { LoginQRCallbackEventType, Zalo } from "zca-js"
import { logger } from "./logger"
import { createProxyAgent } from "./proxy"

export type QrSessionStatus =
  | "pending"
  | "scanned"
  | "confirmed"
  | "expired"
  | "error"

export type QrLoginCredentials = {
  imei: string
  cookie: unknown
  userAgent: string
  zaloUid: string
  displayName: string
  avatar?: string
}

type QrSessionRecord = {
  sessionId: string
  status: QrSessionStatus
  qrImageBase64?: string
  scannedUser?: { displayName: string; avatar?: string }
  credentials?: QrLoginCredentials
  error?: string
  abort?: () => void
  createdAt: number
}

const QR_SESSION_TTL_MS = 3 * 60 * 1000
const QR_GENERATION_TIMEOUT_MS = 15_000

export class QrSessionManager {
  private readonly sessions = new Map<string, QrSessionRecord>()
  private readonly defaultProxyUrl?: string

  constructor(defaultProxyUrl?: string) {
    this.defaultProxyUrl = defaultProxyUrl
  }

  cleanupExpired(): void {
    const now = Date.now()
    for (const [id, session] of this.sessions.entries()) {
      if (now - session.createdAt > QR_SESSION_TTL_MS) {
        session.abort?.()
        this.sessions.delete(id)
      }
    }
  }

  async startSession(proxyUrl?: string): Promise<{
    sessionId: string
    status: QrSessionStatus
    qrImageBase64: string
  }> {
    this.cleanupExpired()
    const sessionId = randomUUID()
    const record: QrSessionRecord = {
      sessionId,
      status: "pending",
      createdAt: Date.now(),
    }
    this.sessions.set(sessionId, record)

    const effectiveProxy = proxyUrl ?? this.defaultProxyUrl
    const zalo = new Zalo({
      selfListen: false,
      checkUpdate: false,
      logging: false,
      ...(effectiveProxy ? { agent: createProxyAgent(effectiveProxy) } : {}),
    })

    let loginInfo: {
      imei: string
      cookie: unknown
      userAgent: string
    } | null = null

    const qrReadyPromise = new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error("Timed out waiting for Zalo QR code generation"))
      }, QR_GENERATION_TIMEOUT_MS)

      zalo
        .loginQR({}, (event) => {
          switch (event.type) {
            case LoginQRCallbackEventType.QRCodeGenerated: {
              clearTimeout(timer)
              record.qrImageBase64 = event.data.image
              record.abort = () => {
                try {
                  event.actions.abort()
                } catch {
                  // ignore abort errors
                }
              }
              resolve(event.data.image)
              break
            }
            case LoginQRCallbackEventType.QRCodeScanned: {
              record.status = "scanned"
              record.scannedUser = {
                displayName: event.data.display_name,
                avatar: event.data.avatar,
              }
              break
            }
            case LoginQRCallbackEventType.QRCodeExpired: {
              record.status = "expired"
              break
            }
            case LoginQRCallbackEventType.QRCodeDeclined: {
              record.status = "error"
              record.error = "QR login declined on device"
              break
            }
            case LoginQRCallbackEventType.GotLoginInfo: {
              loginInfo = {
                imei: event.data.imei,
                cookie: event.data.cookie,
                userAgent: event.data.userAgent,
              }
              break
            }
            default:
              break
          }
        })
        .then(async (api) => {
          if (!loginInfo) {
            record.status = "error"
            record.error = "Missing login credentials after QR confirmation"
            return
          }
          const zaloUid = api.getOwnId()
          let displayName = record.scannedUser?.displayName ?? zaloUid
          let avatar = record.scannedUser?.avatar
          try {
            const info = await api.fetchAccountInfo()
            const profile = (
              info as {
                profile?: {
                  displayName?: string
                  zaloName?: string
                  avatar?: string
                }
              }
            )?.profile
            if (profile?.displayName || profile?.zaloName) {
              displayName =
                profile.displayName ?? profile.zaloName ?? displayName
            }
            if (profile?.avatar) {
              avatar = profile.avatar
            }
          } catch (err) {
            logger.warn(
              { err, zaloUid },
              "Failed to fetch Zalo account info after QR login",
            )
          }

          record.credentials = {
            ...loginInfo,
            zaloUid,
            displayName,
            avatar,
          }
          record.status = "confirmed"
        })
        .catch((err: unknown) => {
          clearTimeout(timer)
          if (record.status === "pending" || record.status === "scanned") {
            record.status = "error"
            record.error =
              err instanceof Error ? err.message : "QR login failed"
          }
          reject(err)
        })
    })

    const qrImageBase64 = await qrReadyPromise
    return {
      sessionId,
      status: record.status,
      qrImageBase64,
    }
  }

  getStatus(sessionId: string): {
    sessionId: string
    status: QrSessionStatus
    scannedUser?: { displayName: string; avatar?: string }
    credentials?: QrLoginCredentials
    error?: string
  } | null {
    this.cleanupExpired()
    const record = this.sessions.get(sessionId)
    if (!record) {
      return null
    }

    const result = {
      sessionId: record.sessionId,
      status: record.status,
      ...(record.scannedUser ? { scannedUser: record.scannedUser } : {}),
      ...(record.credentials ? { credentials: record.credentials } : {}),
      ...(record.error ? { error: record.error } : {}),
    }

    // Clear credentials from memory once read on confirmed status
    if (record.status === "confirmed" && record.credentials) {
      this.sessions.delete(sessionId)
    }

    return result
  }
}
