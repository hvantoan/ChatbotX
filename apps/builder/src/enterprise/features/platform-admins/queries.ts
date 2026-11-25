import type { PlatformAdminList } from "@inboxos.io/business"
import { platformAdminService } from "@inboxos.io/business"
import { assertPlatformSuperAdmin } from "@/lib/auth/assert-platform-super-admin"

export const listPlatformAdmins = async (
  page: number,
): Promise<PlatformAdminList> => {
  await assertPlatformSuperAdmin()

  return await platformAdminService.list({ page, perPage: 50 })
}
