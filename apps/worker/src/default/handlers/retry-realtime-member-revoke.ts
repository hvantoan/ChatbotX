import { revokeWorkspaceMemberRealtimeConnections } from "@inboxos.io/business"
import type { JobRetryRealtimeMemberRevoke } from "@inboxos.io/worker-config"

export const retryRealtimeMemberRevoke = async (
  data: JobRetryRealtimeMemberRevoke["data"],
): Promise<void> => {
  await revokeWorkspaceMemberRealtimeConnections(data)
}
