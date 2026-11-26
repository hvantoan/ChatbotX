"use client"

import type { OrderStatus } from "@inboxos.io/database/partials"
import { Badge } from "@inboxos.io/ui/components/ui/badge"
import { useTranslations } from "next-intl"

const STATUS_VARIANTS = {
  pending: "outline",
  accepted: "secondary",
  shipped: "secondary",
  concluded: "default",
  cancelled: "destructive",
} as const satisfies Record<
  OrderStatus,
  "default" | "secondary" | "outline" | "destructive"
>

export function OrderStatusBadge({ status }: { status: OrderStatus }) {
  const t = useTranslations("orders.statuses")
  return <Badge variant={STATUS_VARIANTS[status]}>{t(status)}</Badge>
}
