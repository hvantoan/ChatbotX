import {
  type OpenMiniAppStepSchema,
  openMiniAppStepDefaultFn,
  openMiniAppStepSchema,
} from "@inboxos.io/flow-config"
import type { StepDefinition } from "../definition"
import OpenMiniAppStepEditor from "./editor"
import OpenMiniAppStepViewer from "./viewer"

export const openMiniAppStep: StepDefinition<OpenMiniAppStepSchema> = {
  editor: OpenMiniAppStepEditor,
  viewer: OpenMiniAppStepViewer,
  validator: openMiniAppStepSchema,
  defaultFn: openMiniAppStepDefaultFn,
}
