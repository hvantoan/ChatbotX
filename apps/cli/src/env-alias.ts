const LEGACY_PREFIX = "CHATBOTX_"
const CURRENT_PREFIX = "INBOXOS_"

/**
 * v2.0.0 renamed every `CHATBOTX_*` variable to `INBOXOS_*`. An install or
 * deployment still carrying the old names must keep working for this major, so
 * each legacy value is copied onto its new name when the new name is unset.
 *
 * Mutates `process.env` on purpose: modules that read `process.env` directly
 * (not through `./env`) see the alias too. Remove in the next major version.
 */
export const applyLegacyEnvAliases = (
  source: NodeJS.ProcessEnv = process.env,
): void => {
  const aliased: string[] = []

  for (const [key, value] of Object.entries(source)) {
    if (!key.startsWith(LEGACY_PREFIX) || value === undefined) {
      continue
    }
    const current = `${CURRENT_PREFIX}${key.slice(LEGACY_PREFIX.length)}`
    if (source[current] !== undefined) {
      continue
    }
    source[current] = value
    aliased.push(key)
  }

  if (aliased.length > 0) {
    console.error(
      `${aliased.join(", ")} renamed to ${CURRENT_PREFIX}* in v2.0.0. ` +
        "Still honoured this major; update the environment before v3.",
    )
  }
}
