import {
  type SendCollectionStepSchema,
  sendCollectionStepDefaultFn,
  sendCollectionStepSchema,
} from "@inboxos.io/flow-config"
import type { StepDefinition } from "../definition"
import SendCollectionStepEditor from "./editor"
import SendCollectionStepViewer from "./viewer"

const sendCollectionStep: StepDefinition<SendCollectionStepSchema> = {
  editor: SendCollectionStepEditor,
  viewer: SendCollectionStepViewer,
  validator: sendCollectionStepSchema,
  defaultFn: sendCollectionStepDefaultFn,
}

export default sendCollectionStep
