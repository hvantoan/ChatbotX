import { existsSync, readFileSync } from "node:fs"

const bundle = new URL("../dist/index.mjs", import.meta.url)

if (!existsSync(bundle)) {
  throw new Error("Packaged MCP bundle is missing: dist/index.mjs")
}

const bundleSource = readFileSync(bundle, "utf8")
const guideHeadings = {
  overview: "# InboxOS MCP overview",
  "flows-and-automation": "# Flows and automation",
  "inbox-and-handover": "# Inbox and handover",
  "contacts-and-pipelines": "# Contacts and pipelines",
}

for (const [name, heading] of Object.entries(guideHeadings)) {
  if (!bundleSource.includes(heading)) {
    throw new Error(`Packaged MCP guide is missing from the bundle: ${name}`)
  }
  if (!bundleSource.includes("inboxos://guides/")) {
    throw new Error("Packaged MCP guide URI prefix is missing from the bundle")
  }
}
