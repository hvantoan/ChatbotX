import type { useTranslations } from "next-intl"

type Translate = ReturnType<typeof useTranslations>

const translatedDimensionLabel = (
  t: Translate,
  labelKey: string,
  dimension: string,
): string => {
  if (!dimension) {
    return t("analytics.unknown")
  }
  return t.has(labelKey) ? t(labelKey) : dimension
}

/** Display label for a contact-count channel dimension (`fields.<channel>.label`). */
export const channelDimensionLabel = (t: Translate, dimension: string) =>
  translatedDimensionLabel(t, `fields.${dimension}.label`, dimension)

/** Display label for a contact-count source dimension (`condition.sources.<source>`). */
export const contactSourceDimensionLabel = (t: Translate, dimension: string) =>
  translatedDimensionLabel(t, `condition.sources.${dimension}`, dimension)
