import { zodBigintIdAsString } from "@inboxos.io/utils"
import { z } from "zod"
import { pipelineItemRequest } from "./public"

/** The UI attaches several files in one request; the public API takes one. */
export const addAttachmentsActionRequest = pipelineItemRequest.extend({
  mediaLibraryFileIds: z.array(zodBigintIdAsString()).min(1).max(20),
})
