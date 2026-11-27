// @vitest-environment node

import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"
import { describe, expect, test } from "vitest"

const SRC_ROOT = join(import.meta.dirname, "..", "src")
const TS_LIKE_EXTENSION_PATTERN = /\.(ts|tsx)$/
const USE_CLIENT_DIRECTIVE_PATTERN = /^["']use client["']\s*;?\s*$/
const CLIENT_BUTTON_MODULE = "@inboxos.io/ui/components/ui/button"

function collectSourceFiles(dir: string, results: string[] = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "__tests__") {
      continue
    }

    const fullPath = join(dir, entry)
    const stat = statSync(fullPath)

    if (stat.isDirectory()) {
      collectSourceFiles(fullPath, results)
    } else if (TS_LIKE_EXTENSION_PATTERN.test(entry)) {
      results.push(fullPath)
    }
  }

  return results
}

function isClientFile(source: string) {
  for (const line of source.split("\n")) {
    const trimmed = line.trim()
    if (trimmed === "" || trimmed.startsWith("//")) {
      continue
    }
    return USE_CLIENT_DIRECTIVE_PATTERN.test(trimmed)
  }
  return false
}

/**
 * `buttonVariants` is a pure cva helper, but when it is imported through the
 * `"use client"` `ui/button` module a server component receives a client
 * reference. Calling it during SSR then throws:
 * "Attempted to call buttonVariants() from the server but buttonVariants is on the client".
 * Server components must import it from `ui/button-variants` instead.
 */
describe("server buttonVariants imports", () => {
  test("server files do not import buttonVariants from the client button module", () => {
    const offenders: string[] = []
    const importFromClientButtonPattern = new RegExp(
      `import\\s+(?!type\\b)[^;{]*\\{([^}]*)}\\s*from\\s*["']${CLIENT_BUTTON_MODULE}["']`,
      "gs",
    )

    for (const filePath of collectSourceFiles(SRC_ROOT)) {
      const source = readFileSync(filePath, "utf8")
      if (isClientFile(source)) {
        continue
      }

      for (const match of source.matchAll(importFromClientButtonPattern)) {
        if (match[1]?.includes("buttonVariants")) {
          offenders.push(relative(SRC_ROOT, filePath))
          break
        }
      }
    }

    expect(offenders).toEqual([])
  })
})
