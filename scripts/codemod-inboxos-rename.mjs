#!/usr/bin/env node
/**
 * Repeatable ChatbotX -> InboxOS rename.
 *
 * Run on a branch to apply the rename; re-run it on any branch that was opened
 * before the rename and rebased past it:
 *
 *   node scripts/codemod-inboxos-rename.mjs --dry-run
 *   node scripts/codemod-inboxos-rename.mjs
 *
 * Safe to run twice (a renamed tree has nothing left to match). Delete this
 * file once the branches opened before the rename have been migrated.
 *
 * Four passes, applied in this order because they overlap:
 *   1. the internal npm scope  @chatbotx.io -> @inboxos.io
 *   2. protect identifiers that must keep the old spelling
 *   3. the surface word        chatbotx / ChatbotX / CHATBOTX -> inboxos
 *   4. restore the protected identifiers
 *
 * The scope goes first so that after pass 1 the only remaining `chatbotx.io`
 * is the live domain (app.chatbotx.io), which pass 2 can protect wholesale.
 *
 * Not covered: identifiers read from the environment at deploy time must keep
 * working, so `infas/` and the compose files are edited by hand rather than
 * rewritten here (see docs/inboxos-rename.md).
 */
import { execFileSync } from "node:child_process"
import { existsSync, readFileSync, writeFileSync } from "node:fs"

const DRY_RUN = process.argv.includes("--dry-run")

/**
 * Identifiers that must keep the old spelling. Each is a persisted value, a
 * durable infrastructure name, or something outside this repository.
 */
const PROTECTED = [
  "ChatbotXIO/ChatbotX", // the repository itself is not renamed
  "ChatbotXIO", // GitHub org
  "chatbotx.io", // live domain: app.chatbotx.io, links in published docs
  "chatbotx-agent", // downstream repository driven by publish workflows
  "chatbotx-prod", // compose project — names the existing docker volumes
  "chatbotx-network", // compose network, also overridden by CHATBOTX_NETWORK
  '"chatbotx"', // persisted storeSource value, integration name, npm bin and
  // MCP client-config keys (the last two are renamed by hand)
  "`chatbotx`", // prose that names that same integration
  "-g chatbotx", // the old command name in uninstall instructions
  '"CHATBOTX_"', // the legacy env prefix the alias helper matches on
  "CHATBOTX_*", // prose and migration notes that refer to the old variables
  // Longest first: these must be protected before the shorter "chatbotx:".
  "postgresql://chatbotx:secretkey@localhost:5432/chatbotx", // dev database
  "postgresql://chatbotx:secretkey@localhost:25432/chatbotx", // dev-up.sh port
  "chatbotx:", // runtime coordination names: redis prefixes, migration
  // advisory lock, integration/connection registry keys
  "S3_BUCKET=chatbotx", // bucket that already holds production objects
  ".chatbotX", // ~/.chatbotX/config.json in every installed CLI
]

/**
 * Paths a text pass cannot rename. Replayed with `git mv`, skipped when the
 * source no longer exists (already renamed).
 */
const PATH_RENAMES = [
  [
    ".github/assets/readme/chatbotx-hero.png",
    ".github/assets/readme/inboxos-hero.png",
  ],
  [
    ".github/assets/readme/chatbotx-logo-dark.svg",
    ".github/assets/readme/inboxos-logo-dark.svg",
  ],
  [
    ".github/assets/readme/chatbotx-logo-light.svg",
    ".github/assets/readme/inboxos-logo-light.svg",
  ],
  [
    ".github/workflows/publish-chatbotx-mcp.yml",
    ".github/workflows/publish-inboxos-mcp.yml",
  ],
  [".agents/skills/chatbotx-basecode", ".agents/skills/inboxos-basecode"],
  [".devin/rules/chatbotx.md", ".devin/rules/inboxos.md"],
  [
    "apps/builder/src/features/mcp-oauth/manage-chatbotx-mcp.tsx",
    "apps/builder/src/features/mcp-oauth/manage-inboxos-mcp.tsx",
  ],
  [
    "apps/builder/src/app/space/[workspaceId]/(settings)/settings/integrations/chatbotx-mcp",
    "apps/builder/src/app/space/[workspaceId]/(settings)/settings/integrations/inboxos-mcp",
  ],
  // The integration's runtime `name` stays "chatbotx" (persisted channel
  // identifier); only its package and directory follow the new brand.
  ["integrations/chatbotx", "integrations/inboxos"],
]

const RENAMES = [
  ["ChatBotX", "InboxOS"],
  ["ChatbotX", "InboxOS"],
  ["CHATBOTX", "INBOXOS"],
  ["chatbotx", "inboxos"],
]

/** Not rewritten: historical records and the hand-edited infra files. */
const SKIP = [
  /^pnpm-lock\.yaml$/,
  /^plans\//,
  /^docs\/adr\//,
  /^docs\/inboxos-rename\.md$/, // the migration record itself
  /^infas\//,
  /^docker-compose[^/]*\.ya?ml$/,
  // Applied migrations and their snapshots are immutable history: rewriting a
  // stored default here would both lie about what ran and fail db:check-drift.
  /^packages\/database\/drizzle\//,
  /\.(png|jpe?g|gif|webp|ico|pdf|woff2?|ttf|zip|gz|tgz)$/i,
]

// Private-use code points keep a protected token distinguishable from text that
// was legitimately renamed. Written as escapes: no invisible character lives in
// this file, because a formatter can silently strip them.
const OPEN = ""
const CLOSE = ""
const HAS_LEGACY_NAME = /chatbotx/i

const marker = (index) => `${OPEN}${index}${CLOSE}`

/** @returns {string | null} null when the file needs no change */
function transform(text) {
  if (!HAS_LEGACY_NAME.test(text)) {
    return null
  }

  let out = text.replaceAll("@chatbotx.io", "@inboxos.io")

  const restored = []
  for (const [index, token] of PROTECTED.entries()) {
    if (!out.includes(token)) {
      continue
    }
    out = out.split(token).join(marker(index))
    restored.push([index, token])
  }

  for (const [from, to] of RENAMES) {
    out = out.replaceAll(from, to)
  }

  for (const [index, token] of restored) {
    out = out.split(marker(index)).join(token)
  }

  return out === text ? null : out
}

let moved = 0
for (const [from, to] of PATH_RENAMES) {
  if (DRY_RUN) {
    if (existsSync(from)) {
      moved += 1
      console.log(`would rename path ${from} -> ${to}`)
    }
    continue
  }
  try {
    execFileSync("git", ["mv", from, to], { stdio: "ignore" })
    moved += 1
  } catch {
    // already renamed, or never present on this branch
  }
}

const files = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" })
  .split("\0")
  .filter(Boolean)

let changed = 0
const changedFiles = []
const remaining = []

for (const file of files) {
  if (SKIP.some((pattern) => pattern.test(file))) {
    continue
  }

  let text
  try {
    text = readFileSync(file, "utf8")
  } catch {
    continue // unreadable or not a regular file
  }
  if (text.includes("\0")) {
    continue // binary
  }

  const next = transform(text)
  if (next !== null) {
    changed += 1
    changedFiles.push(file)
    if (!DRY_RUN) {
      writeFileSync(file, next)
    }
  }

  if (HAS_LEGACY_NAME.test(next ?? text)) {
    remaining.push(file)
  }
}

console.log(
  `${DRY_RUN ? "would rename" : "renamed"} ${changed} of ${files.length} tracked files` +
    `, ${DRY_RUN ? "would move" : "moved"} ${moved} paths`,
)
if (DRY_RUN && changedFiles.length > 0) {
  console.log(`\n${changedFiles.length} files would change:`)
  for (const file of changedFiles.slice(0, 40)) {
    console.log(`  ${file}`)
  }
}
if (remaining.length > 0) {
  console.log(`\n${remaining.length} files still contain "chatbotx":`)
  for (const file of remaining.slice(0, 40)) {
    console.log(`  ${file}`)
  }
  if (remaining.length > 40) {
    console.log(`  ... and ${remaining.length - 40} more`)
  }
}
