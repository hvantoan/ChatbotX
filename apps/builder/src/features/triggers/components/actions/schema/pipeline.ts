import {
  type PipelineActionSchema,
  pipelineActionDefaultFn,
  pipelineActionSchema,
} from "@inboxos.io/flow-config"

export const pipeline = pipelineActionSchema
export type PipelineAction = PipelineActionSchema

export const defaultFn = () => pipelineActionDefaultFn()
