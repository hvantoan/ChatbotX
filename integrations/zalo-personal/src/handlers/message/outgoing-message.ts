import {
  type SendAudioStepSchema,
  type SendFileStepSchema,
  type SendGifStepSchema,
  type SendImageStepSchema,
  type SendMultipleImagesStepSchema,
  type SendTextStepSchema,
  type SendVideoStepSchema,
  type StepType,
  stepTypes,
} from "@chatbotx.io/flow-config"
import {
  contentTypes,
  type MessageHandlers,
  type OutgoingSendResult,
  type SendFlowStepProps,
} from "@chatbotx.io/sdk"
import { gatewayClient } from "../../lib/gateway-client"
import { logger } from "../../lib/logger"
import type { ZaloPersonalAuthValue } from "../../schema"
import { GROUP_THREAD_PREFIX } from "./incoming-message"

export const handledFlowStepTypes = [
  stepTypes.enum.sendText,
  stepTypes.enum.sendImage,
  stepTypes.enum.sendMultipleImages,
  stepTypes.enum.sendVideo,
  stepTypes.enum.sendAudio,
  stepTypes.enum.sendFile,
  stepTypes.enum.sendGif,
] as const satisfies readonly StepType[]

export function resolveTargetThread(sourceId: string): {
  threadId: string
  threadType: "user" | "group"
} {
  if (sourceId.startsWith(GROUP_THREAD_PREFIX)) {
    return {
      threadId: sourceId.slice(GROUP_THREAD_PREFIX.length),
      threadType: "group",
    }
  }
  return {
    threadId: sourceId,
    threadType: "user",
  }
}

export const sendMessage: MessageHandlers<ZaloPersonalAuthValue>["sendMessage"] =
  async (props): Promise<OutgoingSendResult> => {
    const {
      ctx,
      data: { contact, message },
    } = props

    const { threadId, threadType } = resolveTargetThread(contact.sourceId)
    const zaloUid = ctx.auth.zaloUid

    if (message.contentType !== contentTypes.enum.text) {
      return { messageIds: [], sentCount: 0 }
    }

    const attachments = (message.attachments ?? [])
      .filter((att): att is typeof att & { url: string } => Boolean(att.url))
      .map((att) => ({
        url: att.url,
        filename:
          att.name ?? `attachment.${att.fileType === "image" ? "jpg" : "bin"}`,
        fileType: (att.fileType === "image" ||
        att.fileType === "video" ||
        att.fileType === "audio"
          ? att.fileType
          : "file") as "image" | "video" | "audio" | "file",
      }))

    if (!message.text && attachments.length === 0) {
      return { messageIds: [], sentCount: 0 }
    }

    const result = await gatewayClient.sendMessage({
      zaloUid,
      threadId,
      threadType,
      text: message.text ?? "",
      ...(attachments.length > 0 ? { attachments } : {}),
    })

    return {
      messageIds: result.messageIds,
      sentCount: result.messageIds.length || 1,
    }
  }

export const sendFlowStep = async (
  props: SendFlowStepProps<ZaloPersonalAuthValue>,
): Promise<OutgoingSendResult> => {
  const {
    ctx,
    data: { contact, step },
  } = props

  const { threadId, threadType } = resolveTargetThread(contact.sourceId)
  const zaloUid = ctx.auth.zaloUid

  switch (step.stepType) {
    case stepTypes.enum.sendText: {
      const s = step as SendTextStepSchema
      const result = await gatewayClient.sendMessage({
        zaloUid,
        threadId,
        threadType,
        text: s.text,
      })
      return {
        messageIds: result.messageIds,
        sentCount: result.messageIds.length || 1,
      }
    }
    case stepTypes.enum.sendImage: {
      const s = step as SendImageStepSchema
      if (!s.url) {
        return { messageIds: [], sentCount: 0 }
      }
      const result = await gatewayClient.sendMessage({
        zaloUid,
        threadId,
        threadType,
        attachments: [{ url: s.url, filename: "image.jpg", fileType: "image" }],
      })
      return {
        messageIds: result.messageIds,
        sentCount: result.messageIds.length || 1,
      }
    }
    case stepTypes.enum.sendMultipleImages: {
      const s = step as SendMultipleImagesStepSchema
      const images = (s.images ?? []).filter((img) => Boolean(img.url))
      if (images.length === 0) {
        return { messageIds: [], sentCount: 0 }
      }
      const result = await gatewayClient.sendMessage({
        zaloUid,
        threadId,
        threadType,
        attachments: images.map((img, i) => ({
          url: img.url as string,
          filename: `image-${i + 1}.jpg`,
          fileType: "image" as const,
        })),
      })
      return {
        messageIds: result.messageIds,
        sentCount: result.messageIds.length || images.length,
      }
    }
    case stepTypes.enum.sendVideo: {
      const s = step as SendVideoStepSchema
      if (!s.url) {
        return { messageIds: [], sentCount: 0 }
      }
      const result = await gatewayClient.sendMessage({
        zaloUid,
        threadId,
        threadType,
        attachments: [{ url: s.url, filename: "video.mp4", fileType: "video" }],
      })
      return {
        messageIds: result.messageIds,
        sentCount: result.messageIds.length || 1,
      }
    }
    case stepTypes.enum.sendAudio: {
      const s = step as SendAudioStepSchema
      if (!s.url) {
        return { messageIds: [], sentCount: 0 }
      }
      const result = await gatewayClient.sendMessage({
        zaloUid,
        threadId,
        threadType,
        attachments: [{ url: s.url, filename: "audio.mp3", fileType: "audio" }],
      })
      return {
        messageIds: result.messageIds,
        sentCount: result.messageIds.length || 1,
      }
    }
    case stepTypes.enum.sendFile: {
      const s = step as SendFileStepSchema
      if (!s.url) {
        return { messageIds: [], sentCount: 0 }
      }
      const filename = s.url.split("/").pop()?.split("?")[0] || "file.bin"
      const result = await gatewayClient.sendMessage({
        zaloUid,
        threadId,
        threadType,
        attachments: [{ url: s.url, filename, fileType: "file" }],
      })
      return {
        messageIds: result.messageIds,
        sentCount: result.messageIds.length || 1,
      }
    }
    case stepTypes.enum.sendGif: {
      const s = step as SendGifStepSchema
      if (!s.url) {
        return { messageIds: [], sentCount: 0 }
      }
      const result = await gatewayClient.sendMessage({
        zaloUid,
        threadId,
        threadType,
        attachments: [
          { url: s.url, filename: "animation.gif", fileType: "image" },
        ],
      })
      return {
        messageIds: result.messageIds,
        sentCount: result.messageIds.length || 1,
      }
    }
    default: {
      logger.warn(
        { stepType: step.stepType },
        "Unsupported flow step for zalo_personal",
      )
      return { messageIds: [], sentCount: 0 }
    }
  }
}
