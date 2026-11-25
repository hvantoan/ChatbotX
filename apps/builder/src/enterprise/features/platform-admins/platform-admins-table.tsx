"use client"

import type { PlatformAdminList } from "@inboxos.io/business"
import {
  type PlatformAdminRole,
  platformAdminRoles,
} from "@inboxos.io/database/partials"
import { Button } from "@inboxos.io/ui/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@inboxos.io/ui/components/ui/dialog"
import { Input } from "@inboxos.io/ui/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@inboxos.io/ui/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@inboxos.io/ui/components/ui/table"
import { Loader2Icon, PlusIcon, Trash2Icon } from "lucide-react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useTranslations } from "next-intl"
import { useAction } from "next-safe-action/hooks"
import { use, useState } from "react"
import { toast } from "sonner"
import { addPlatformAdminAction } from "./add-platform-admin.action"
import { removePlatformAdminAction } from "./remove-platform-admin.action"

const platformAdminRoleTranslationKeys = {
  "super-admin": "platformAdmin.admins.roles.superAdmin",
  support: "platformAdmin.admins.roles.support",
} as const satisfies Record<PlatformAdminRole, string>
type PlatformAdminsTableProps = {
  page: number
  promises: Promise<[PlatformAdminList]>
}
export function PlatformAdminsTable({
  page,
  promises,
}: PlatformAdminsTableProps) {
  const [{ data, pageCount }] = use(promises)
  const router = useRouter()
  const t = useTranslations()
  const [email, setEmail] = useState("")
  const [role, setRole] = useState<PlatformAdminRole>("support")
  const [addDialogOpen, setAddDialogOpen] = useState(false)

  const addAdmin = useAction(addPlatformAdminAction, {
    onError: () => {
      toast.error(t("platformAdmin.admins.addError"))
    },
    onSuccess: () => {
      setAddDialogOpen(false)
      setEmail("")
      setRole("support")
      toast.success(t("platformAdmin.admins.added"))
      router.refresh()
    },
  })
  const removeAdmin = useAction(removePlatformAdminAction, {
    onError: () => {
      toast.error(t("platformAdmin.admins.removeError"))
    },
    onSuccess: () => {
      toast.success(t("platformAdmin.admins.removed"))
      router.refresh()
    },
  })

  const hasAdmins = data.length > 0

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    addAdmin.execute({ email, role })
  }

  return (
    <>
      <div className="flex justify-end">
        <Button
          onClick={() => {
            setRole("support")
            setAddDialogOpen(true)
          }}
          size="sm"
        >
          <PlusIcon aria-hidden="true" />
          {t("platformAdmin.admins.addButton")}
        </Button>
      </div>

      <div className="overflow-hidden rounded-md border">
        <Table>
          <TableHeader className="bg-muted/50 text-muted-foreground">
            <TableRow className="hover:bg-transparent">
              <TableHead className="h-auto px-4 py-3 text-muted-foreground">
                {t("fields.email.label")}
              </TableHead>
              <TableHead className="h-auto px-4 py-3 text-muted-foreground">
                {t("platformAdmin.admins.role")}
              </TableHead>
              <TableHead className="h-auto w-12 px-4 py-3" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.map((admin) => (
              <TableRow key={admin.id}>
                <TableCell className="px-4 py-3">{admin.userEmail}</TableCell>
                <TableCell className="px-4 py-3 text-muted-foreground">
                  {t(platformAdminRoleTranslationKeys[admin.role])}
                </TableCell>
                <TableCell className="px-4 py-3 text-end">
                  <Button
                    aria-label={t("platformAdmin.admins.remove")}
                    disabled={removeAdmin.isPending}
                    onClick={() =>
                      removeAdmin.execute({ userId: admin.userId })
                    }
                    size="icon"
                    variant="ghost"
                  >
                    {removeAdmin.isPending ? (
                      <Loader2Icon
                        aria-hidden="true"
                        className="animate-spin"
                      />
                    ) : (
                      <Trash2Icon aria-hidden="true" />
                    )}
                  </Button>
                </TableCell>
              </TableRow>
            ))}
            {!hasAdmins && (
              <TableRow>
                <TableCell
                  className="px-4 py-6 text-center text-muted-foreground"
                  colSpan={3}
                >
                  {t("platformAdmin.admins.empty")}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {pageCount > 1 && (
        <div className="flex justify-end gap-2">
          <Button
            disabled={page <= 1}
            render={<Link href={`?page=${page - 1}`} />}
            size="sm"
            variant="outline"
          >
            {t("actions.prev")}
          </Button>
          <Button
            disabled={page >= pageCount}
            render={<Link href={`?page=${page + 1}`} />}
            size="sm"
            variant="outline"
          >
            {t("actions.next")}
          </Button>
        </div>
      )}

      <Dialog onOpenChange={setAddDialogOpen} open={addDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("platformAdmin.admins.addTitle")}</DialogTitle>
            <DialogDescription>
              {t("platformAdmin.admins.addDescription")}
            </DialogDescription>
          </DialogHeader>
          <form className="space-y-4" onSubmit={handleSubmit}>
            <div className="space-y-2">
              <label
                className="font-medium text-sm"
                htmlFor="platform-admin-email"
              >
                {t("fields.email.label")}
              </label>
              <Input
                autoComplete="email"
                id="platform-admin-email"
                onChange={(event) => setEmail(event.target.value)}
                placeholder={t("fields.email.placeholder")}
                required
                type="email"
                value={email}
              />
            </div>
            <div className="space-y-2">
              <label
                className="font-medium text-sm"
                htmlFor="platform-admin-role"
              >
                {t("platformAdmin.admins.role")}
              </label>
              <Select
                onValueChange={(value) => setRole(value as PlatformAdminRole)}
                value={role}
              >
                <SelectTrigger id="platform-admin-role">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {platformAdminRoles.map((platformAdminRole) => (
                    <SelectItem
                      key={platformAdminRole}
                      value={platformAdminRole}
                    >
                      {t(platformAdminRoleTranslationKeys[platformAdminRole])}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <DialogFooter>
              <Button
                disabled={addAdmin.isPending}
                onClick={() => setAddDialogOpen(false)}
                type="button"
                variant="outline"
              >
                {t("actions.cancel")}
              </Button>
              <Button
                disabled={addAdmin.isPending || email.length === 0}
                type="submit"
              >
                {addAdmin.isPending && (
                  <Loader2Icon aria-hidden="true" className="animate-spin" />
                )}
                {t("actions.confirm")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
