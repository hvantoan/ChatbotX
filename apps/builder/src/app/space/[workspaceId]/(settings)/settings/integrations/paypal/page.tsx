import { paymentProviderService } from "@inboxos.io/business"
import { getIdFromParams } from "@inboxos.io/utils"
import { notFound } from "next/navigation"
import { ManagePaypal } from "@/features/payment-providers/components/manage-paypal"

export default async function SettingIntegrationPaypalPage(props: {
  params: Promise<{ workspaceId: string }>
}) {
  const workspaceId = getIdFromParams(await props.params, "workspaceId")
  if (!workspaceId) {
    return notFound()
  }
  const connections = await paymentProviderService.list(workspaceId)
  return (
    <ManagePaypal
      connection={connections.find((row) => row.provider === "paypal") ?? null}
      workspaceId={workspaceId}
    />
  )
}
