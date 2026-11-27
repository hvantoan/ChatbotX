import { z } from "zod"

/**
 * Machine-set "pinned contact" condition — the server-side audience constraint
 * of a reminder draft (Master Agent pins one group contact) and of any other
 * audience a system composes itself.
 *
 * Never surfaced in the "add condition" picker (no entry in
 * `CONTACT_FILTER_FIELD_DEFINITIONS`), for the same reason as
 * `ctwaRetargetConditionSchema`: it is not a user-chosen filter. It still has
 * to be a first-class schema branch, because a filter the UI cannot parse is
 * replaced with an empty one on the next save — which would silently widen the
 * audience to every contact with a direct chat.
 */
// Digit strings compare lexicographically at equal length, so the signed
// bigint ceiling needs no BigInt() call (which throws on non-digits).
const MAX_SIGNED_BIGINT = "9223372036854775807"

const contactIdValueSchema = z
  .string()
  .trim()
  .regex(/^\d{1,19}$/u, "Contact id must be a positive bigint.")
  .refine(
    (value) => value.length < 19 || value <= MAX_SIGNED_BIGINT,
    "Contact id must fit in a signed bigint.",
  )
  .describe("Contact id as a decimal bigint string.")

const contactIdFieldSchema = z
  .literal("contactId")
  .describe("Always `contactId`: pins the audience to these contacts.")

export const contactIdConditionSchema = z.discriminatedUnion("operator", [
  z.object({
    field: contactIdFieldSchema,
    operator: z.literal("eq").describe("`eq` pins exactly one contact."),
    value: contactIdValueSchema,
  }),
  z.object({
    field: contactIdFieldSchema,
    operator: z.literal("in").describe("`in` pins several contacts."),
    value: z
      .array(contactIdValueSchema)
      .min(1)
      .max(500)
      .describe("Contact ids the audience is pinned to."),
  }),
])

export type ContactIdCondition = z.infer<typeof contactIdConditionSchema>
