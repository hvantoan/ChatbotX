/**
 * Guide content lives in `@inboxos.io/openapi-catalog` as embedded string
 * constants, shared with the Master Agent worker — a bundled consumer never
 * reads markdown from disk. This module re-exports it under the path the MCP
 * server has always used.
 */
export {
  type Guide,
  type GuideName,
  getGuide,
  guideNames,
  isGuideName,
} from "@inboxos.io/openapi-catalog"
