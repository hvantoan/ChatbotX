"use client"

import type { LeaderboardStatus } from "@inboxos.io/database/partials"
import { Badge } from "@inboxos.io/ui/components/ui/badge"
import { cn } from "@inboxos.io/ui/lib/utils"
import { useTranslations } from "next-intl"
import {
  LEADERBOARD_STATUS_CLASS_NAME,
  LEADERBOARD_STATUS_LABEL_KEY,
} from "../lib/platforms"

export function LeaderboardStatusBadge({
  status,
}: {
  status: LeaderboardStatus
}) {
  const t = useTranslations()
  return (
    <Badge
      className={cn(LEADERBOARD_STATUS_CLASS_NAME[status])}
      variant="outline"
    >
      {t(LEADERBOARD_STATUS_LABEL_KEY[status])}
    </Badge>
  )
}
