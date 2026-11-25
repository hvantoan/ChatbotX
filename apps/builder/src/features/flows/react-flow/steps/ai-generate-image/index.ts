"use client"

import type { AIGenerateImageSchema } from "@inboxos.io/flow-config"
import {
  aiGenerateImageDefaultFn,
  aiGenerateImageSchema,
} from "@inboxos.io/flow-config"
import type { StepDefinition } from "../definition"
import { AIGenerateImageEditor } from "./editor"
import { AIGenerateImageViewer } from "./viewer"

export const aiGenerateImageStep: StepDefinition<AIGenerateImageSchema> = {
  editor: AIGenerateImageEditor,
  viewer: AIGenerateImageViewer,
  validator: aiGenerateImageSchema,
  defaultFn: aiGenerateImageDefaultFn,
}

export default aiGenerateImageStep
