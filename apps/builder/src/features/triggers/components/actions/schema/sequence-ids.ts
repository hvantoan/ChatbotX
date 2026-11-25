import { MAX_SEQUENCES_PER_TRIGGER_ACTION } from "@inboxos.io/database/partials"
import { zodBigintIdAsString } from "@inboxos.io/utils"
import z from "zod"

/** The `sequenceIds` of the add/remove sequence trigger actions. */
export const sequenceIdsField = (description: string) =>
  z
    .array(zodBigintIdAsString())
    .min(1)
    .max(MAX_SEQUENCES_PER_TRIGGER_ACTION)
    .describe(description)
