import { pipelineStageBulkService } from "@inboxos.io/business/pipeline"
import type { JobProcessPipelineStageBulk } from "@inboxos.io/worker-config"

export const processPipelineStageBulk = async (
  data: JobProcessPipelineStageBulk["data"],
): Promise<void> => {
  await pipelineStageBulkService.processQueued(data)
}

/** Blocked owner: the job no-ops, so the stage must not stay claimed forever. */
export const releasePipelineStageBulkClaim = async (
  data: JobProcessPipelineStageBulk["data"],
): Promise<void> => {
  await pipelineStageBulkService.releaseClaim(data)
}
