import { ecommerceSettingsService, orderService } from "@inboxos.io/business"
import { InboxOSException } from "@inboxos.io/business/errors"
import { notFound } from "next/navigation"
import { OrderDetail } from "@/features/orders/components/order-detail"
import { assertCurrentUserCanAccessChatbot } from "@/lib/auth/utils"

const ORDER_ID_PATTERN = /^\d+$/

export default async function OrderDetailPage({
  params,
}: {
  params: Promise<{ workspaceId: string; orderId: string }>
}) {
  const { workspaceId, orderId } = await params
  if (!ORDER_ID_PATTERN.test(orderId)) {
    notFound()
  }
  await assertCurrentUserCanAccessChatbot(workspaceId)

  const [order, settings] = await Promise.all([
    orderService.getDetail({ workspaceId, orderId }).catch((error) => {
      if (error instanceof InboxOSException && error.code === "notFound") {
        return null
      }
      throw error
    }),
    ecommerceSettingsService.get(workspaceId),
  ])
  if (!order) {
    notFound()
  }

  return (
    <OrderDetail
      order={order}
      store={{
        currency: settings.payments.currency,
        currencySymbol: settings.payments.currencySymbol,
        currencyPosition: settings.payments.currencyPosition,
      }}
      workspaceId={workspaceId}
    />
  )
}
