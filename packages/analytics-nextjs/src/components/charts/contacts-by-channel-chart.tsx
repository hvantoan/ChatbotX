"use client"

import { DonutChart } from "@inboxos.io/ui/components/charts/donut-chart"
import { useTranslations } from "next-intl"
import { useMemo } from "react"
import { useAnalysisStore } from "../../provider/analysis-store-context"
import { channelDimensionLabel } from "../../utils/dimension-label"

export function ContactsByChannelChart() {
  const t = useTranslations()
  const contactsByChannel = useAnalysisStore((state) => state.contactsByChannel)

  const data = useMemo(
    () =>
      contactsByChannel.map((item) => ({
        name: channelDimensionLabel(t, item.dimension),
        value: item.uniqueContacts,
      })),
    [contactsByChannel, t],
  )

  return (
    <DonutChart
      data={data}
      noDataLabel={t("analytics.noData")}
      title={t("analytics.newContactsByChannel")}
      valueLabel={t("analytics.contacts")}
    />
  )
}
