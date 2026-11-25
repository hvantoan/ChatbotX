import { triggerActions } from "@inboxos.io/database/partials"
import { zodBigintAsString } from "@inboxos.io/utils"
import z from "zod"

export const startFlow = z.object({
  type: z
    .literal(triggerActions.enum.startAnotherFlow)
    .describe('Action type "startAnotherFlow".'),
  flowId: zodBigintAsString().describe(
    "Id of the flow (from `flows.list`) to start for the contact.",
  ),
})
export type StartFlow = z.infer<typeof startFlow>

export const defaultFn = (): StartFlow => ({
  type: triggerActions.enum.startAnotherFlow,
  flowId: "",
})
