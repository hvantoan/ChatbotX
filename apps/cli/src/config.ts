import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { parseBooleanEnv } from "./commands/utils"
import { env } from "./env"

export type ConfigOptions = {
  apiKey?: string
  apiUrl?: string
  allowSelfSignedCert?: boolean
}

export type CliConfig = {
  apiKey: string
  apiUrl: string
  allowSelfSignedCert?: boolean
}

const CONFIG_DIR = ".inboxos"
const LEGACY_CONFIG_DIR = ".chatbotX"
const CONFIG_FILE = "config.json"

const getConfigFilePath = (): string => join(homedir(), CONFIG_DIR, CONFIG_FILE)
const getLegacyConfigFilePath = (): string =>
  join(homedir(), LEGACY_CONFIG_DIR, CONFIG_FILE)

/**
 * v2.0.0 moved the config file to `~/.inboxos/config.json`. An install that
 * saved its API key under the old directory keeps working: the legacy location
 * is read, never written, so the next `config set` moves it forward.
 */
const readStoredConfig = (): ConfigOptions => {
  for (const path of [getConfigFilePath(), getLegacyConfigFilePath()]) {
    try {
      return JSON.parse(readFileSync(path, "utf8")) as ConfigOptions
    } catch {
      // missing or unreadable: try the next location
    }
  }
  return {}
}

const writeStoredConfig = (config: ConfigOptions): void => {
  const dir = join(homedir(), CONFIG_DIR)
  mkdirSync(dir, { recursive: true })
  writeFileSync(getConfigFilePath(), JSON.stringify(config, null, 2), "utf8")
}

export const setApiKey = (apiKey: string): void => {
  const trimmedApiKey = apiKey.trim()

  if (!trimmedApiKey) {
    throw new Error("API key is empty")
  }

  const current = readStoredConfig()
  writeStoredConfig({
    ...current,
    apiKey: trimmedApiKey,
  })
}

export const setApiUrl = (apiUrl: string): void => {
  const trimmedApiUrl = apiUrl.trim()

  if (!trimmedApiUrl) {
    throw new Error("API URL is empty")
  }

  const current = readStoredConfig()
  writeStoredConfig({
    ...current,
    apiUrl: trimmedApiUrl,
  })
}

export const setAllowSelfSignedCert = (allowSelfSignedCert: boolean): void => {
  const current = readStoredConfig()
  writeStoredConfig({
    ...current,
    allowSelfSignedCert,
  })
}

export const getConfig = (overrides?: ConfigOptions): CliConfig => {
  const stored = readStoredConfig()

  const apiKey = overrides?.apiKey ?? env.INBOXOS_API_KEY ?? stored.apiKey

  const apiUrl = overrides?.apiUrl ?? env.INBOXOS_API_URL ?? stored.apiUrl

  const allowSelfSignedCert =
    overrides?.allowSelfSignedCert ??
    parseBooleanEnv(env.INBOXOS_ALLOW_SELF_SIGNED_CERT) ??
    stored.allowSelfSignedCert

  if (!apiKey) {
    throw new Error(
      "Missing API key. Run: inboxos config set --apiKey your_api_key",
    )
  }

  if (!apiUrl) {
    throw new Error(
      "Missing API URL. Run: inboxos config set --apiUrl your_api_url",
    )
  }

  return {
    apiKey,
    apiUrl,
    allowSelfSignedCert,
  }
}
