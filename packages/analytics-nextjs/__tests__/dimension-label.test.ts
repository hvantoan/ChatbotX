// @vitest-environment node
import { describe, expect, test } from "vitest"
import {
  channelDimensionLabel,
  contactSourceDimensionLabel,
} from "../src/utils/dimension-label"

const translatorFor = (messages: Record<string, string>) =>
  Object.assign((key: string) => messages[key] ?? key, {
    has: (key: string) => key in messages,
  }) as unknown as Parameters<typeof channelDimensionLabel>[0]

describe("dimension labels", () => {
  test("uses the translated channel field label", () => {
    const t = translatorFor({ "fields.zalo_personal.label": "Zalo Personal" })

    expect(channelDimensionLabel(t, "zalo_personal")).toBe("Zalo Personal")
  })

  test("uses the translated contact source label", () => {
    const t = translatorFor({
      "condition.sources.inboundMessage": "Tin nhắn đến",
    })

    expect(contactSourceDimensionLabel(t, "inboundMessage")).toBe(
      "Tin nhắn đến",
    )
  })

  test("keeps an untranslated dimension readable instead of dropping it", () => {
    const t = translatorFor({})

    expect(channelDimensionLabel(t, "future_channel")).toBe("future_channel")
    expect(contactSourceDimensionLabel(t, "futureSource")).toBe("futureSource")
  })

  test("uses the unknown label for an empty dimension", () => {
    const t = translatorFor({ "analytics.unknown": "Unknown" })

    expect(channelDimensionLabel(t, "")).toBe("Unknown")
    expect(contactSourceDimensionLabel(t, "")).toBe("Unknown")
  })
})
