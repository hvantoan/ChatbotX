# InboxOS rename (v2.0.0)

The product brand moved from **ChatbotX** to **InboxOS**. This is the v2.0.0
breaking release: the command, the environment variables, the Docker images and
the internal npm scope all changed at once. Everything a running deployment or
an installed CLI needs in order to keep working is listed here.

One rename pass, one major version. Do not spread these changes over several
releases.

## What changed

| Surface | Before | After | Breaking |
| --- | --- | --- | --- |
| Internal npm scope | `@chatbotx.io/*` | `@inboxos.io/*` | No — workspace-internal, all import sites updated |
| CLI package | `chatbotx` (npm) | `@hvantoan/inboxos` | No — package name was already changed |
| CLI command | `chatbotx` | `inboxos` | **Yes** |
| MCP package | `chatbotx-mcp` (npm) | `@hvantoan/inboxos-mcp` | No — package name was already changed |
| MCP command | `chatbotx-mcp` | `inboxos-mcp` | **Yes** |
| MCP client config key | `"chatbotx"` | `"inboxos"` | Yes — for saved client configs |
| Environment variables | `CHATBOTX_*` | `INBOXOS_*` | No this major — old names aliased, see below |
| CLI config file | `~/.chatbotX/config.json` | `~/.inboxos/config.json` | No — old path still read |
| CLI API cache | `~/.chatbotX/openapi-cache.json` | `~/.inboxos/openapi-cache.json` | No — cache is regenerated |
| Docker images | `ghcr.io/*/chatbotx-{builder,…}` | `ghcr.io/*/inboxos-{builder,…}` | Yes — for image consumers only |
| Builder route | `/settings/integrations/chatbotx-mcp` | `…/inboxos-mcp` | Yes — for bookmarked URLs |
| Brand strings | "ChatbotX" | "InboxOS" | No |

## What kept its old name, and why

These are **persisted values or durable infrastructure**, not branding. Renaming
them is a data migration, not a rename, so they stay:

| Kept | Where | Why |
| --- | --- | --- |
| `"chatbotx"` store-source value | `packages/database/src/partials/ecommerce.ts`, stored in `EcommerceSettings`, `Product`, `ProductCategory`, `DiscountCode`, `Vendor` | Existing rows store this value |
| `"chatbotx"` integration name | `integrations/inboxos/src/integration.ts`, `integrationNames`, connection and channel registries | Persisted channel/connection type |
| `"chatbotx"` i18n key | `messages/*.json` → `storeSource.options.chatbotx` | Keyed by that persisted value; only the label reads "InboxOS" |
| `chatbotx:*` | Redis sync key `chatbotx:workspace-deletion-scheduled`, migration advisory lock `chatbotx:database:migrations` | Coordination names; changing them lets a mixed-version deploy take different locks |
| `S3_BUCKET=chatbotx`, `local/chatbotx` | `.env.example`, `docker-compose.yml` | The bucket already holds objects |
| `postgresql://chatbotx:…@…/chatbotx` | `.env.example`, `scripts/dev-up.sh` | The local database and role that exist |
| `chatbotx-prod`, `chatbotx-network` | `infas/**`, `docker-compose*.yml` | Compose project and network name the existing volumes |
| `ChatbotXIO`, `ChatbotXIO/ChatbotX`, `ChatbotXIO/chatbotx-agent`, `chatbotx.io` | links, `repository.url` | GitHub org and repo, downstream repo, live domain — each is separate infrastructure |
| `~/.chatbotX/` (read only) | `apps/cli/src/config.ts` | Holds the user's saved API key |
| Applied migrations, ADRs, journals, `plans/` | `packages/database/drizzle/**`, `docs/adr/**`, `plans/**` | Immutable history |

The scope `@inboxos.io` cannot be published to npm (a scope may not contain a
dot), the same as `@chatbotx.io`. Internal packages resolve through the
workspace, so this only matters if an internal package is ever published — that
would need a second, scopeless name.

## Upgrading an installed CLI

```bash
npm uninstall -g chatbotx        # otherwise it shadows the new command
npm install -g @hvantoan/inboxos
inboxos --version
```

- `CHATBOTX_API_URL` / `CHATBOTX_API_KEY` / `CHATBOTX_ALLOW_SELF_SIGNED_CERT`
  still work: each is copied onto its `INBOXOS_*` name when the new name is
  unset, and a deprecation line is printed to stderr. Fix the environment before
  the next major.
- `~/.chatbotX/config.json` is still read. Running `inboxos config set …` once
  writes `~/.inboxos/config.json`, and the old file is then unused.

## Upgrading MCP clients

Replace the command and the server key in the client config:

```json
{
  "mcpServers": {
    "inboxos": {
      "command": "npx",
      "args": ["-y", "@hvantoan/inboxos-mcp"]
    }
  }
}
```

`claude mcp add inboxos -t http -s user "<builder>/mcp/messages"` replaces
`claude mcp add chatbotx …`, and the old entry must be removed (`claude mcp
remove chatbotx`) or both will appear.

## Upgrading a self-hosted deployment

Environment variables keep working through the alias, so nothing must change
before the containers start. Two things are worth doing when convenient:

1. Rename `CHATBOTX_*` to `INBOXOS_*` in the deployment's `.env`.
2. `infas/docker-compose.prod.yml` reads `${INBOXOS_<SVC>_IMAGE:-${CHATBOTX_<SVC>_IMAGE:-inboxos-<svc>:latest}}`,
   so an existing `CHATBOTX_BUILDER_IMAGE` override still wins. New installs get
   `inboxos-*` image names from `release.yml`.

Do **not** rename the compose project, the network, the volumes or the bucket on
a running deployment — those names carry the data.

## Release steps that are not in the repository

- `npm deprecate chatbotx "Renamed to @hvantoan/inboxos"` and
  `npm deprecate chatbotx-mcp "Renamed to @hvantoan/inboxos-mcp"` — signals the
  move to anyone installing the old names.
- Rename the repository secret `CHATBOTX_AGENT_DISPATCH_TOKEN` to
  `INBOXOS_AGENT_DISPATCH_TOKEN`. The publish workflows read the new name; while
  it is absent the `chatbotx-agent` notification step skips itself
  (`continue-on-error`), so publishing is unaffected.
- Tag `v2.0.0` after the gates below pass. Versions are not stored in the repo;
  the publish workflows stamp the tag's version.

## Verifying the rename

```bash
git grep -n '@chatbotx\.io' -- . ':!pnpm-lock.yaml'          # 0 lines
git grep -in 'chatbotx' -- . ':!pnpm-lock.yaml' \
  | grep -viE 'migrat|deprecat|changelog|kept|persisted|store-source|registry|legacy'
pnpm lint && pnpm check-types && pnpm build
node apps/cli/dist/index.cjs --version
```

## Replaying this rename on a branch opened before it

`scripts/codemod-inboxos-rename.mjs` is the rename itself, kept until the
branches opened before v2.0.0 have migrated. Rebase such a branch onto the
rename commit and re-run it:

```bash
node scripts/codemod-inboxos-rename.mjs --dry-run
node scripts/codemod-inboxos-rename.mjs
CI=true pnpm install --no-frozen-lockfile
```

It is idempotent: a second run reports 0 changes. It skips applied migrations,
ADRs, journals, `plans/` and `infas/`, and protects the persisted identifiers in
the table above. Delete it once no branch needs it.
