import { folderTypes } from "@inboxos.io/database/partials"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@inboxos.io/ui/components/ui/card"
import { getIdFromParams } from "@inboxos.io/utils"
import { notFound } from "next/navigation"
import { getTranslations } from "next-intl/server"
import type { SearchParams } from "nuqs/server"
import SharedFolderSlot from "@/features/folders/shared-folder-slot"
import { listSequences } from "@/features/sequences/queries"
import { listSequencesSearchParamsCache } from "@/features/sequences/schema/action"
import { SequencesTable } from "@/features/sequences/sequences-table"
import { assertCurrentUserCanAccessChatbot } from "@/lib/auth/utils"

export default async function SequencesPage(props: {
  params: Promise<{ workspaceId: string }>
  searchParams: Promise<SearchParams>
}) {
  const workspaceId = getIdFromParams(await props.params, "workspaceId")
  if (!workspaceId) {
    return notFound()
  }

  const searchParams = await props.searchParams
  const search = await listSequencesSearchParamsCache.parse(searchParams)
  const t = await getTranslations()

  await assertCurrentUserCanAccessChatbot(workspaceId)

  const promises = Promise.all([
    listSequences({
      ...search,
      workspaceId,
    }),
  ])

  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-bold text-xl">
          {t("sequences.title")}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <SharedFolderSlot
          folderType={folderTypes.enum.sequence}
          searchParams={props.searchParams}
          workspaceId={workspaceId}
        />
        <SequencesTable promises={promises} workspaceId={workspaceId} />
      </CardContent>
    </Card>
  )
}
