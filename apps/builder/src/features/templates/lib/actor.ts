import type { TemplateActor } from "@inboxos.io/business"

export type MemberPermissions = Extract<
  TemplateActor,
  { kind: "member" }
>["permissions"]

export const memberActor = (permissions: MemberPermissions): TemplateActor => ({
  kind: "member",
  permissions,
})
