"use client"

import { DonutChart } from "@inboxos.io/ui/components/charts/donut-chart"
import { useTranslations } from "next-intl"
import { useMemo } from "react"
import { useAnalysisStore } from "../../provider/analysis-store-context"
import { channelDimensionLabel } from "../../utils/dimension-label"

export function AllContactsByChannelChart() {
  const t = useTranslations()
  const allContactsByChannel = useAnalysisStore(
    (state) => state.allContactsByChannel,
  )

  const data = useMemo(
    () =>
      allContactsByChannel.map((item) => ({
        name: channelDimensionLabel(t, item.dimension),
        value: item.uniqueContacts,
      })),
    [allContactsByChannel, t],
  )

  return (
    <DonutChart
      data={data}
      noDataLabel={t("analytics.noData")}
      title={t("analytics.allContactsByChannel")}
      valueLabel={t("analytics.contacts")}
    />
  )
}
