"use client"

import { DonutChart } from "@inboxos.io/ui/components/charts/donut-chart"
import { useTranslations } from "next-intl"
import { useMemo } from "react"
import { useAnalysisStore } from "../../provider/analysis-store-context"
import { contactSourceDimensionLabel } from "../../utils/dimension-label"

export function ContactsBySourceChart() {
  const t = useTranslations()
  const contactsBySource = useAnalysisStore((state) => state.contactsBySource)

  const data = useMemo(
    () =>
      contactsBySource.map((item) => ({
        name: contactSourceDimensionLabel(t, item.dimension),
        value: item.uniqueContacts,
      })),
    [contactsBySource, t],
  )

  return (
    <DonutChart
      data={data}
      noDataLabel={t("analytics.noData")}
      title={t("analytics.newContactsBySource")}
      valueLabel={t("analytics.contacts")}
    />
  )
}
