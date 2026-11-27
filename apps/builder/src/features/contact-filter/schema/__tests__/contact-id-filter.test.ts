import { describe, expect, test } from "vitest"
import { contactIdConditionSchema } from "../contact-id-filter"

describe("contactIdConditionSchema", () => {
  test("accepts one bigint-safe contact id for eq", () => {
    const result = contactIdConditionSchema.safeParse({
      field: "contactId",
      operator: "eq",
      value: "123456789",
    })

    expect(result.success).toBe(true)
  })

  test("rejects a nonnumeric contact id", () => {
    const result = contactIdConditionSchema.safeParse({
      field: "contactId",
      operator: "eq",
      value: "group:K5",
    })

    expect(result.success).toBe(false)
  })

  test("rejects an id outside signed bigint range", () => {
    const result = contactIdConditionSchema.safeParse({
      field: "contactId",
      operator: "eq",
      value: "9223372036854775808",
    })

    expect(result.success).toBe(false)
  })

  test("rejects an array value for eq", () => {
    const result = contactIdConditionSchema.safeParse({
      field: "contactId",
      operator: "eq",
      value: ["123", "456"],
    })

    expect(result.success).toBe(false)
  })

  test("accepts a nonempty id array for in", () => {
    const result = contactIdConditionSchema.safeParse({
      field: "contactId",
      operator: "in",
      value: ["123", "456"],
    })

    expect(result.success).toBe(true)
  })

  test("rejects a scalar or empty array for in", () => {
    expect(
      contactIdConditionSchema.safeParse({
        field: "contactId",
        operator: "in",
        value: "123",
      }).success,
    ).toBe(false)
    expect(
      contactIdConditionSchema.safeParse({
        field: "contactId",
        operator: "in",
        value: [],
      }).success,
    ).toBe(false)
  })
})
