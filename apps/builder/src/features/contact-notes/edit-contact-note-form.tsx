"use client"

import { zodResolver } from "@hookform/resolvers/zod"
import type { ContactNoteModel } from "@inboxos.io/database/types"
import { InputField } from "@inboxos.io/ui/components/form/input-field"
import { TextareaField } from "@inboxos.io/ui/components/form/textarea-field"
import { Button } from "@inboxos.io/ui/components/ui/button"
import { Form } from "@inboxos.io/ui/components/ui/form"
import { useHookFormAction } from "@next-safe-action/adapter-react-hook-form/hooks"
import { useTranslations } from "next-intl"
import { toast } from "sonner"
import { editContactNoteAction } from "./actions/edit-contact-note.action"
import { updateContactNoteRequest } from "./schema/action"

export function EditContactForm({
  workspaceId,
  contactId,
  contactNote,
  onCancel,
  onSuccess,
}: {
  workspaceId: string
  contactId: string
  contactNote: ContactNoteModel
  onCancel: () => void
  onSuccess: (data: ContactNoteModel) => void
}) {
  const t = useTranslations()

  const { form, handleSubmitWithAction, resetFormAndAction } =
    useHookFormAction(
      editContactNoteAction.bind(null, workspaceId, contactId),
      zodResolver(updateContactNoteRequest),
      {
        actionProps: {
          onSuccess: ({ data }) => {
            toast.success(
              t("messages.updatedSuccess", {
                feature: t("fields.contactNote.label"),
              }),
            )
            resetFormAndAction()
            onSuccess(data)
          },
          onError: ({ error }) => {
            if (error.serverError) {
              toast.error(error.serverError)
            }
          },
        },
        formProps: {
          mode: "onChange",
          defaultValues: {
            text: contactNote.text,
            contactNoteId: contactNote.id.toString(),
          },
        },
        errorMapProps: {},
      },
    )

  return (
    <Form {...form}>
      <form
        className="flex w-full flex-col gap-3"
        onSubmit={handleSubmitWithAction}
      >
        <InputField name="contactNoteId" type="hidden" />
        <TextareaField label="" name="text" placeholder="..." />
        <div className="flex justify-end gap-2">
          <Button onClick={onCancel} size="sm" type="button" variant="ghost">
            {t("actions.cancel")}
          </Button>
          <Button size="sm" type="submit">
            {t("actions.save")}
          </Button>
        </div>
      </form>
    </Form>
  )
}
