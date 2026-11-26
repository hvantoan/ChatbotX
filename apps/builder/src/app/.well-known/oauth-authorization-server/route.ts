import { getMcpAuthorizationServerMetadata } from "@inboxos.io/auth"
import { auth } from "@/lib/auth/auth"

export const GET = getMcpAuthorizationServerMetadata(auth)
