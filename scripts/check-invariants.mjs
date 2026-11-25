import { execFileSync } from "node:child_process"
import { existsSync } from "node:fs"
import { readFile } from "node:fs/promises"
import path from "node:path"

/**
 * Enforces the mechanical AGENTS.md invariants that Biome cannot express.
 *
 * Each check here used to live only as prose an agent had to remember. A rule a
 * script can verify belongs in `pnpm lint`, not in the always-loaded context.
 * The direct-`db` import ban lives in `biome.json` (`noRestrictedImports`).
 */

const root = process.cwd()

const TSDOWN_ROOTS = [
  "packages/",
  "integrations/",
  "apps/worker/",
  "apps/cli/",
  "apps/mcp-server/",
  "apps/javascript-executor/",
]
const SERVER_ROOTS = ["apps/", "packages/", "integrations/"]
const RELATIONS_INDEX = "packages/database/src/relations/index.ts"

// Legacy runtime dynamic imports kept on purpose; never add to this list.
const DYNAMIC_IMPORT_ALLOWLIST = new Set([
  // Loads AsyncLocalStorage lazily so the module still imports on the Edge Runtime.
  "packages/events/src/trigger/context.ts",
])

const SOURCE_FILE = /\.(ts|tsx|mts|cts)$/
const TEST_PATH = /(^|\/)__tests__\/|\.(test|spec)\.tsx?$/
const COMMENT_LINE = /^\s*(\/\/|\*|\/\*)/
const RUNTIME_DYNAMIC_IMPORT =
  /(\bawait\s+import\(|=>\s*import\(|\bimport\([^)]*\)\s*\.then\b)/
const LOGGER_ERROR_KEY =
  /\.(fatal|error|warn|info|debug|trace)\(\s*\{\s*error\s*[,}]/
const PRISMA_IMPORT = /from\s+["']@prisma\//
const RADIX_IMPORT = /from\s+["'](@radix-ui\/|radix-ui["'])/
const DIRECT_BASE_UI_IMPORT = /from\s+["']@base-ui\/react/
const DEAD_RADIX_STATE =
  /data-\[state=(open|closed|checked|delayed-open)\]|--radix-/
const INVALID_HSL_TOKEN = /hsl\(var\(--/
const UI_CLIENT_COMPONENT = /^packages\/ui\/src\/components\/.*\.tsx$/
const USE_CLIENT_DIRECTIVE = /^\s*["']use client["'];?\s*$/
const RELATIONS_IMPORT = /import\s*\{([^}]*)\}\s*from\s*["']\.\/[^"']+["']/g

const violations = []
const report = (file, line, message) =>
  violations.push({ location: line ? `${file}:${line}` : file, message })

const listTrackedSources = () =>
  execFileSync("git", ["ls-files", "-z", "apps", "packages", "integrations"], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  })
    .split("\0")
    .filter(
      (file) =>
        SOURCE_FILE.test(file) &&
        !TEST_PATH.test(file) &&
        existsSync(path.join(root, file)),
    )

const startsWithAny = (file, prefixes) =>
  prefixes.some((prefix) => file.startsWith(prefix))

const checkLines = (file, lines) => {
  const isTsdown = startsWithAny(file, TSDOWN_ROOTS)
  const isServer = startsWithAny(file, SERVER_ROOTS)
  const isApp = file.startsWith("apps/")
  const isUiLayer =
    file.startsWith("packages/ui/src/") || file.startsWith("apps/builder/src/")

  lines.forEach((text, index) => {
    if (COMMENT_LINE.test(text)) {
      return
    }

    const line = index + 1

    if (
      isTsdown &&
      !DYNAMIC_IMPORT_ALLOWLIST.has(file) &&
      RUNTIME_DYNAMIC_IMPORT.test(text)
    ) {
      report(
        file,
        line,
        "dynamic import() breaks the tsdown build; use a static import (.agents/rules/no-dynamic-import.md)",
      )
    }

    if (isServer && LOGGER_ERROR_KEY.test(text)) {
      report(
        file,
        line,
        "log the error under `err`, not `error`, or pino drops the stack trace (AGENTS.md invariant 20)",
      )
    }

    if (PRISMA_IMPORT.test(text)) {
      report(
        file,
        line,
        "this project uses Drizzle only, never Prisma (AGENTS.md invariant 8)",
      )
    }

    if (RADIX_IMPORT.test(text)) {
      report(
        file,
        line,
        "InboxOS uses @base-ui/react via @inboxos.io/ui, never Radix UI",
      )
    }

    if (isApp && DIRECT_BASE_UI_IMPORT.test(text)) {
      report(
        file,
        line,
        "import UI primitives from @inboxos.io/ui/* instead of @base-ui/react directly",
      )
    }

    if (isUiLayer && DEAD_RADIX_STATE.test(text)) {
      report(
        file,
        line,
        "use Base UI data attributes (data-open, data-popup-open, data-panel-open, data-checked) instead of Radix data-[state=*] / --radix-*",
      )
    }

    if (isUiLayer && INVALID_HSL_TOKEN.test(text)) {
      report(
        file,
        line,
        "theme tokens use oklch(), not HSL triplets — use var(--...) directly instead of hsl(var(--...))",
      )
    }
  })
}

const checkUiClientDirective = (file, lines) => {
  if (!UI_CLIENT_COMPONENT.test(file)) {
    return
  }

  const importsBaseUi = lines.some((text) => DIRECT_BASE_UI_IMPORT.test(text))
  if (!importsBaseUi) {
    return
  }

  const firstNonEmpty = lines
    .map((text) => text.trim())
    .filter((text) => text.length > 0 && !COMMENT_LINE.test(text))
    .slice(0, 5)

  if (!firstNonEmpty.some((text) => USE_CLIENT_DIRECTIVE.test(text))) {
    report(
      file,
      1,
      'packages/ui components importing @base-ui/react must declare "use client"',
    )
  }
}

// A relations file that is imported but never spread into the `relations`
// object silently breaks Drizzle relational queries (AGENTS.md invariant 2).
const checkRelationsIndex = async () => {
  const content = await readFile(path.join(root, RELATIONS_INDEX), "utf8")
  const importedNames = [...content.matchAll(RELATIONS_IMPORT)].flatMap(
    (match) =>
      match[1]
        .split(",")
        .map((name) => name.trim())
        .filter(Boolean),
  )

  for (const name of importedNames) {
    const uses = content.match(new RegExp(`\\b${name}\\b`, "g")) ?? []

    if (uses.length < 2) {
      report(
        RELATIONS_INDEX,
        null,
        `\`${name}\` is imported but not added to the relations object`,
      )
    }
  }
}

const main = async () => {
  const files = listTrackedSources()

  for (const file of files) {
    const content = await readFile(path.join(root, file), "utf8")
    const lines = content.split("\n")
    checkLines(file, lines)
    checkUiClientDirective(file, lines)
  }

  await checkRelationsIndex()

  if (violations.length > 0) {
    console.error(`Invariant check failed (${violations.length} problem(s)):`)

    for (const { location, message } of violations) {
      console.error(`  ${location}: ${message}`)
    }

    process.exit(1)
  }

  console.log(`Checked ${files.length} source files — invariants hold`)
}

try {
  await main()
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
}
