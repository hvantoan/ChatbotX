import { randomUUID } from "node:crypto"
import type Redis from "ioredis"
import { logger } from "./logger"

const LOCK_PREFIX = "zalo-personal:listener:lock:"
const DEFAULT_TTL_MS = 30_000

const RENEW_SCRIPT = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("pexpire", KEYS[1], ARGV[2])
else
  return 0
end
`

const RELEASE_SCRIPT = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
else
  return 0
end
`

export type LockHandle = {
  key: string
  token: string
  renew: () => Promise<boolean>
  release: () => Promise<void>
}

export class RedisListenerLock {
  private readonly redis: Redis
  private readonly ttlMs: number

  constructor(redis: Redis, ttlMs: number = DEFAULT_TTL_MS) {
    this.redis = redis
    this.ttlMs = ttlMs
  }

  async acquire(zaloUid: string): Promise<LockHandle | null> {
    const key = `${LOCK_PREFIX}${zaloUid}`
    const token = randomUUID()
    const result = await this.redis.set(key, token, "PX", this.ttlMs, "NX")

    if (result !== "OK") {
      return null
    }

    return {
      key,
      token,
      renew: async () => {
        try {
          const res = await this.redis.eval(
            RENEW_SCRIPT,
            1,
            key,
            token,
            String(this.ttlMs),
          )
          return Number(res) === 1
        } catch (err) {
          logger.error({ err, zaloUid }, "Failed to renew listener lock")
          return false
        }
      },
      release: async () => {
        try {
          await this.redis.eval(RELEASE_SCRIPT, 1, key, token)
        } catch (err) {
          logger.error({ err, zaloUid }, "Failed to release listener lock")
        }
      },
    }
  }
}
