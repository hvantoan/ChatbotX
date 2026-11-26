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
export const contactIdConditionSchema = z.object({
  field: z
    .literal("contactId")
    .describe("Always `contactId`: pins the audience to these contacts."),
  operator: z
    .enum(["eq", "in"])
    .describe("`eq` for one contact id, `in` for several."),
  value: z
    .union([
      z.string().trim().min(1),
      z.array(z.string().trim().min(1)).min(1).max(500),
    ])
    .describe("Contact id (or ids) the audience is pinned to."),
})

export type ContactIdCondition = z.infer<typeof contactIdConditionSchema>
