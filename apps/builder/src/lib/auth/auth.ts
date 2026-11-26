import { createAuth } from "@inboxos.io/auth/server"
import { onUserCreated } from "./on-user-created"

export const auth = createAuth({ onUserCreated })
