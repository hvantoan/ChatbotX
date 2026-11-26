import type { DecisionProfileModel } from "@inboxos.io/database/types"

export type DecisionProfileListItem = DecisionProfileModel & {
  connectionName: string | null
  globalRouter: {
    reason?:
      | "configInvalid"
      | "connectionUnavailable"
      | "modelUnsupported"
      | "profileDisabled"
    status: "active" | "inactive" | "off"
  }
}
