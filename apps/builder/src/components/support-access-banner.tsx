import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@inboxos.io/ui/components/ui/alert"
import { formatDate } from "@inboxos.io/ui/lib/format"
import { ShieldCheckIcon } from "lucide-react"
import { getLocale, getTranslations } from "next-intl/server"

export async function SupportAccessBanner({
  consentRequired,
  supportAccessUntil,
}: {
  consentRequired: boolean
  supportAccessUntil: Date | null
}) {
  const [t, locale] = await Promise.all([
    getTranslations("workspace.supportAccess"),
    getLocale(),
  ])
  const time = supportAccessUntil
    ? formatDate(supportAccessUntil, {
        hour: "numeric",
        minute: "numeric",
        locale,
      })
    : null

  return (
    <Alert variant="default">
      <ShieldCheckIcon />
      <AlertTitle>{t("bannerTitle")}</AlertTitle>
      <AlertDescription>
        {consentRequired && time
          ? t("bannerDescription", { time })
          : t("consentDisabled")}
      </AlertDescription>
    </Alert>
  )
}
