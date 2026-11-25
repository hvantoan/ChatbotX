import {
  baseNodeDataSchema,
  conditionNodeSchema,
  conditionStepSchema,
} from "@inboxos.io/flow-config"
import { zodBigintAsString } from "@inboxos.io/utils"
import { z } from "zod"
import { flowConditionFilterCriteriaSchema } from "@/features/contact-filter/schema"

const conditionCaseEditorSchema = flowConditionFilterCriteriaSchema.extend({
  id: zodBigintAsString(),
})

const conditionStepEditorSchema = conditionStepSchema.extend({
  cases: z.array(conditionCaseEditorSchema).min(1),
})

export const conditionNodeEditorSchema = conditionNodeSchema.extend({
  data: baseNodeDataSchema.extend({
    details: z.object({
      steps: z.array(conditionStepEditorSchema).min(1).max(1),
    }),
  }),
})
