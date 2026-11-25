import { getIdFromParams } from "@inboxos.io/utils"
import { notFound } from "next/navigation"

export default async function FbCommentsLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ workspaceId: string }>
}) {
  const workspaceId = getIdFromParams(await params, "workspaceId")
  if (!workspaceId) {
    return notFound()
  }

  return children
}
