import { SYSTEM_ACTOR } from "@inboxos.io/business/audit"
import { db } from "@inboxos.io/database/client"
import { auditLogModel } from "@inboxos.io/database/schema"
import { createId } from "@inboxos.io/utils"
import type { JobSendAuditLog } from "@inboxos.io/worker-config"
import { env } from "../../env"

export const sendAuditLog = async (data: JobSendAuditLog["data"]) => {
  if (env.NEXT_PUBLIC_EDITION === "community") {
    return
  }
  const { userId, workspaceId, action, detail, ipAddress, userAgent, source } =
    data
  const persistedUserId = userId === SYSTEM_ACTOR ? null : userId
  await db
    .insert(auditLogModel)
    .values({
      id: data.auditLogId ?? createId(),
      userId: persistedUserId,
      workspaceId,
      action,
      detail,
      ipAddress,
      userAgent,
      source,
    })
    .onConflictDoNothing()
}
