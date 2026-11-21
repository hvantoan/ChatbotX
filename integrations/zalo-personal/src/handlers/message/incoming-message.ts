import {
  type Context,
  contentTypes,
  type IncomingAttachment,
  type IncomingContact,
  type IncomingMessage,
  messageTypes,
  type ReceivedMessageResult,
} from "@chatbotx.io/sdk"
import {
  type ZaloPersonalAuthValue,
  zaloPersonalWebhookPayloadSchema,
} from "../../schema"

export const GROUP_THREAD_PREFIX = "group:"

export function toContactSourceId(
  threadType: "user" | "group",
  threadId: string,
): string {
  return threadType === "group" ? `${GROUP_THREAD_PREFIX}${threadId}` : threadId
}

const MIME_BY_TYPE: Record<"image" | "video" | "audio" | "file", string> = {
  image: "image/jpeg",
  video: "video/mp4",
  audio: "audio/mpeg",
  file: "application/octet-stream",
}

export const receiveMessage = ({
  data,
}: {
  ctx: Context<ZaloPersonalAuthValue>
  data: {
    integrationType: string
    integrationIdentifier: string
    payload: unknown
  }
}): Promise<ReceivedMessageResult> => {
  const payload = zaloPersonalWebhookPayloadSchema.parse(data.payload)

  const attachments: IncomingAttachment[] = payload.attachments.map(
    (att, idx) => ({
      sourceId: `${payload.messageId}:${idx}`,
      fileType: att.type,
      mimeType: MIME_BY_TYPE[att.type],
      originPath: att.url,
      size: 0,
      url: att.url,
      ...(att.name ? { name: att.name } : {}),
    }),
  )

  const incomingMessage: IncomingMessage = {
    sourceId: payload.messageId,
    messageType: payload.isSelf
      ? messageTypes.enum.outgoing
      : messageTypes.enum.incoming,
    text:
      payload.threadType === "group" && payload.text
        ? `[${payload.senderName}] ${payload.text}`
        : payload.text || undefined,
    contentType: contentTypes.enum.text,
    attachments,
  }

  const avatar = payload.threadAvatar ?? payload.senderAvatar
  const contact: IncomingContact = {
    sourceId: toContactSourceId(payload.threadType, payload.threadId),
    firstName:
      payload.threadName ||
      (payload.threadType === "group"
        ? `Group ${payload.threadId}`
        : payload.senderName),
    ...(avatar ? { avatar } : {}),
  }

  return Promise.resolve({
    message: incomingMessage,
    contact,
    postbackAction: null,
    quickReplyAction: null,
    ref: null,
    ...(payload.timestamp > 0
      ? { occurredAt: new Date(payload.timestamp) }
      : {}),
    ...(payload.isHistorySync ? { suppressAutomation: true } : {}),
  })
}
