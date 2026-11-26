import { decisionProfileFormSchema } from "@inboxos.io/decision-config"
import { zodBigintAsString } from "@inboxos.io/utils"

/**
 * A profile is returned in the same authoring shape it accepts on create and
 * update. The persistence-only provider contract is deliberately omitted.
 */
export const publicDecisionProfileSchema = decisionProfileFormSchema.extend({
  id: zodBigintAsString().describe("AI Router profile id."),
})
