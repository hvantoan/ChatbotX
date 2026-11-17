import { stepTypes } from "../../steps/step-action"
import { defineChannelFlowPolicy } from "./define"

// Personal Zalo accounts support text and media messages without interactive buttons.
export const zaloPersonalFlowPolicy = defineChannelFlowPolicy({
  limits: {
    buttonCount: 0,
    cardButtonCount: 0,
    buttonLabel: 0,
    text: 2000,
  },
  noButtons: [
    stepTypes.enum.sendText,
    stepTypes.enum.sendImage,
    stepTypes.enum.sendMultipleImages,
    stepTypes.enum.sendVideo,
    stepTypes.enum.sendAudio,
    stepTypes.enum.sendFile,
    stepTypes.enum.sendGif,
  ],
})
