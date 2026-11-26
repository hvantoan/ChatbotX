import type { AuditLogModel } from "@inboxos.io/database/types"
import type { UserResource } from "@/features/users/schema/resource"

export type AuditLogResource = AuditLogModel & {
  user?: UserResource | null
}
