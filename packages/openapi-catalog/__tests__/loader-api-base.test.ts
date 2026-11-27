import { describe, expect, test, vi } from "vitest"
import { apiBaseUrlFromBuilderUrl } from "../src/api-base"
import { createSpecLoader } from "../src/loader"

describe("apiBaseUrlFromBuilderUrl", () => {
  test("derives the public API base from the builder origin", () => {
    expect(apiBaseUrlFromBuilderUrl("https://builder.example.com/")).toBe(
      "https://builder.example.com/api",
    )
  })

  test("does not duplicate an already-present api suffix", () => {
    expect(apiBaseUrlFromBuilderUrl("https://builder.example.com/api/")).toBe(
      "https://builder.example.com/api",
    )
  })
})

describe("createSpecLoader api URL", () => {
  test("fetches the spec below the deployment's /api prefix", async () => {
    const fetchFn = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            openapi: "3.1.0",
            info: { title: "test", version: "0" },
            paths: {},
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        ),
    ) as unknown as typeof fetch
    const loader = createSpecLoader({
      apiUrl: apiBaseUrlFromBuilderUrl("https://builder.example.com"),
      ttlMs: 30_000,
      httpTimeoutMs: 1000,
      fetchFn,
      log: () => undefined,
    })

    await loader.load()

    expect(fetchFn).toHaveBeenCalledWith(
      "https://builder.example.com/api/public-spec.json",
      expect.anything(),
    )
  })

  test("executes against the configured base, not the advertised server", async () => {
    const fetchFn = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            openapi: "3.1.0",
            info: { title: "test", version: "0" },
            servers: [{ url: "https://public.example.com/api" }],
            paths: {
              "/contacts/{id}": {
                get: { operationId: "contacts.get", responses: {} },
              },
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    ) as unknown as typeof fetch
    const loader = createSpecLoader({
      apiUrl: "http://builder:3000/api",
      executionBaseUrl: "http://builder:3000/api",
      ttlMs: 30_000,
      httpTimeoutMs: 1000,
      fetchFn,
      log: () => undefined,
    })

    const tools = await loader.load()

    expect(tools[0]?.baseUrl).toBe("http://builder:3000/api")
  })
})
