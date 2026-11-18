"use client"

import { Button } from "@chatbotx.io/ui/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@chatbotx.io/ui/components/ui/dialog"
import { Input } from "@chatbotx.io/ui/components/ui/input"
import { Label } from "@chatbotx.io/ui/components/ui/label"
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@chatbotx.io/ui/components/ui/tabs"
import { Textarea } from "@chatbotx.io/ui/components/ui/textarea"
import Image from "next/image"
import { useRouter } from "next/navigation"
import { useTranslations } from "next-intl"
import { useAction } from "next-safe-action/hooks"
import { type ReactElement, useEffect, useState } from "react"
import { toast } from "sonner"
import { useInvalidateInboxes } from "@/features/inboxes/provider/inbox-hook"
import { connectZaloPersonalAction } from "../actions/connect.action"
import {
  pollZaloPersonalQrAction,
  startZaloPersonalQrAction,
} from "../actions/qr.action"

type ZaloPersonalConnectProps = {
  workspaceId: string
  autoOpen?: boolean
  children?: ReactElement
}

export function ZaloPersonalConnect({
  workspaceId,
  autoOpen = false,
  children,
}: ZaloPersonalConnectProps) {
  const t = useTranslations()
  const router = useRouter()
  const invalidateInboxes = useInvalidateInboxes()
  const [open, setOpen] = useState(autoOpen)

  // QR state
  const [qrName, setQrName] = useState("Zalo Personal")
  const [qrProxyUrl, setQrProxyUrl] = useState("")
  const [qrSessionId, setQrSessionId] = useState<string | null>(null)
  const [qrImageBase64, setQrImageBase64] = useState<string | null>(null)
  const [qrStatus, setQrStatus] = useState<
    "idle" | "pending" | "scanned" | "confirmed" | "expired" | "error"
  >("idle")

  // Credential state
  const [credName, setCredName] = useState("")
  const [imei, setImei] = useState("")
  const [cookie, setCookie] = useState("")
  const [userAgent, setUserAgent] = useState("")
  const [credProxyUrl, setCredProxyUrl] = useState("")

  const { executeAsync: startQr, isPending: isStartingQr } = useAction(
    startZaloPersonalQrAction.bind(null, workspaceId),
    {
      onSuccess: ({ data }) => {
        if (data) {
          setQrSessionId(data.sessionId)
          setQrImageBase64(data.qrImageBase64)
          setQrStatus(data.status)
        }
      },
      onError: ({ error }) => {
        toast.error(error.serverError ?? "Failed to start QR login")
        setQrStatus("error")
      },
    },
  )

  const { executeAsync: pollQr } = useAction(
    pollZaloPersonalQrAction.bind(null, workspaceId),
    {
      onSuccess: ({ data }) => {
        if (!data) {
          return
        }
        setQrStatus(data.status)
        if (data.status === "confirmed") {
          setQrSessionId(null)
          invalidateInboxes()
          router.refresh()
          setOpen(false)
        }
      },
    },
  )

  const { executeAsync: connectCreds, isPending: isConnectingCreds } =
    useAction(connectZaloPersonalAction.bind(null, workspaceId), {
      onSuccess: () => {
        invalidateInboxes()
        router.refresh()
        setOpen(false)
      },
      onError: ({ error }) => {
        toast.error(error.serverError ?? "Failed to connect Zalo Personal")
      },
    })

  useEffect(() => {
    if (
      !(open && qrSessionId) ||
      (qrStatus !== "pending" && qrStatus !== "scanned")
    ) {
      return
    }
    const interval = setInterval(() => {
      pollQr({
        sessionId: qrSessionId,
        name: qrName.trim() || "Zalo Personal",
        proxyUrl: qrProxyUrl.trim() || undefined,
      })
    }, 2000)
    return () => clearInterval(interval)
  }, [open, qrSessionId, qrStatus, qrName, qrProxyUrl, pollQr])

  const handleGenerateQr = () => {
    setQrImageBase64(null)
    setQrSessionId(null)
    startQr({ proxyUrl: qrProxyUrl.trim() || undefined })
  }

  const handleConnectCredentials = (e: React.FormEvent) => {
    e.preventDefault()
    connectCreds({
      name: credName.trim(),
      imei: imei.trim(),
      cookie: cookie.trim(),
      userAgent: userAgent.trim(),
      proxyUrl: credProxyUrl.trim() || undefined,
    })
  }

  const qrStatusMessage = (() => {
    switch (qrStatus) {
      case "scanned":
        return t("fields.zalo_personal.qrScanned")
      case "expired":
        return t("fields.zalo_personal.qrExpired")
      case "confirmed":
        return t("fields.zalo_personal.qrConfirmed")
      default:
        return t("fields.zalo_personal.qrPending")
    }
  })()

  return (
    <Dialog onOpenChange={setOpen} open={open}>
      {children ? <DialogTrigger render={children} /> : null}
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("fields.zalo_personal.connectTitle")}</DialogTitle>
          <DialogDescription>
            {t("fields.zalo_personal.connectDescription")}
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="qr">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="qr">
              {t("fields.zalo_personal.qrTab")}
            </TabsTrigger>
            <TabsTrigger value="credentials">
              {t("fields.zalo_personal.cookieTab")}
            </TabsTrigger>
          </TabsList>

          <TabsContent className="flex flex-col gap-4 pt-2" value="qr">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="zp-qr-name">
                {t("fields.zalo_personal.accountName")}
              </Label>
              <Input
                id="zp-qr-name"
                onChange={(e) => setQrName(e.target.value)}
                placeholder={t("fields.zalo_personal.accountNamePlaceholder")}
                value={qrName}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="zp-qr-proxy">
                {t("fields.zalo_personal.proxyUrl")}
              </Label>
              <Input
                id="zp-qr-proxy"
                onChange={(e) => setQrProxyUrl(e.target.value)}
                placeholder={t("fields.zalo_personal.proxyUrlPlaceholder")}
                value={qrProxyUrl}
              />
            </div>

            {qrImageBase64 ? (
              <div className="flex flex-col items-center gap-2 rounded-md border p-4">
                <Image
                  alt={t("fields.zalo_personal.qrTab")}
                  className="h-48 w-48 rounded"
                  height={192}
                  src={
                    qrImageBase64.startsWith("data:")
                      ? qrImageBase64
                      : `data:image/png;base64,${qrImageBase64}`
                  }
                  unoptimized
                  width={192}
                />
                <p className="text-muted-foreground text-xs">
                  {qrStatusMessage}
                </p>
              </div>
            ) : (
              <p className="text-muted-foreground text-xs">
                {t("fields.zalo_personal.qrHint")}
              </p>
            )}

            <Button
              disabled={isStartingQr}
              onClick={handleGenerateQr}
              type="button"
            >
              {qrImageBase64
                ? t("fields.zalo_personal.regenerateQr")
                : t("fields.zalo_personal.generateQr")}
            </Button>
          </TabsContent>

          <TabsContent value="credentials">
            <form
              className="flex flex-col gap-3 pt-2"
              onSubmit={handleConnectCredentials}
            >
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="zp-cred-name">
                  {t("fields.zalo_personal.accountName")}
                </Label>
                <Input
                  id="zp-cred-name"
                  onChange={(e) => setCredName(e.target.value)}
                  placeholder={t("fields.zalo_personal.accountNamePlaceholder")}
                  required
                  value={credName}
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="zp-imei">
                  {t("fields.zalo_personal.imei")}
                </Label>
                <Input
                  id="zp-imei"
                  onChange={(e) => setImei(e.target.value)}
                  placeholder={t("fields.zalo_personal.imeiPlaceholder")}
                  required
                  value={imei}
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="zp-cookie">
                  {t("fields.zalo_personal.cookie")}
                </Label>
                <Textarea
                  id="zp-cookie"
                  onChange={(e) => setCookie(e.target.value)}
                  placeholder={t("fields.zalo_personal.cookiePlaceholder")}
                  required
                  rows={3}
                  value={cookie}
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="zp-ua">
                  {t("fields.zalo_personal.userAgent")}
                </Label>
                <Input
                  id="zp-ua"
                  onChange={(e) => setUserAgent(e.target.value)}
                  placeholder={t("fields.zalo_personal.userAgentPlaceholder")}
                  required
                  value={userAgent}
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="zp-cred-proxy">
                  {t("fields.zalo_personal.proxyUrl")}
                </Label>
                <Input
                  id="zp-cred-proxy"
                  onChange={(e) => setCredProxyUrl(e.target.value)}
                  placeholder={t("fields.zalo_personal.proxyUrlPlaceholder")}
                  value={credProxyUrl}
                />
              </div>

              <Button disabled={isConnectingCreds} type="submit">
                {t("fields.zalo_personal.connectTitle")}
              </Button>
            </form>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}
