/**
 * The public API lives below the builder origin's `/api` prefix. Spec
 * loading, catalog execution and approval replay all need the same base so a
 * deployment configured as `https://app.example.com` never drops that prefix.
 */
const TRAILING_SLASHES = /\/+$/u

export const apiBaseUrlFromBuilderUrl = (builderUrl: string): string => {
  if (!builderUrl) {
    throw new Error("NEXT_PUBLIC_BUILDER_URL is not configured")
  }
  const normalized = builderUrl.trim().replace(TRAILING_SLASHES, "")
  return normalized.endsWith("/api") ? normalized : `${normalized}/api`
}
