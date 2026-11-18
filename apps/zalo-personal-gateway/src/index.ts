import Redis from "ioredis"
import { env } from "./env"
import { RedisListenerLock } from "./lock"
import { logger } from "./logger"
import { QrSessionManager } from "./qr-manager"
import { createGatewayServer } from "./server"
import { ZaloSessionManager } from "./session-manager"

const redis = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: null,
})

const lockManager = new RedisListenerLock(redis)
const qrManager = new QrSessionManager(env.ZALO_PERSONAL_PROXY_URL)
const sessionManager = new ZaloSessionManager(lockManager, {
  maxAccounts: env.ZALO_PERSONAL_MAX_ACCOUNTS,
  defaultProxyUrl: env.ZALO_PERSONAL_PROXY_URL,
  defaultWebhookSecret: env.ZALO_PERSONAL_WEBHOOK_SECRET,
})

const server = createGatewayServer({
  token: env.ZALO_PERSONAL_GATEWAY_TOKEN,
  qrManager,
  sessionManager,
})

server.listen(env.PORT, env.HOST, () => {
  logger.info(
    { host: env.HOST, port: env.PORT },
    "Zalo personal gateway listening",
  )
})

let shuttingDown = false
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) {
    return
  }
  shuttingDown = true
  logger.info({ signal }, "Shutting down Zalo personal gateway")

  await sessionManager.stopAll()
  await new Promise<void>((resolve) => {
    server.close(() => resolve())
  })
  await redis.quit()
  process.exit(0)
}

process.on("SIGTERM", () => {
  shutdown("SIGTERM").catch(() => process.exit(1))
})
process.on("SIGINT", () => {
  shutdown("SIGINT").catch(() => process.exit(1))
})
