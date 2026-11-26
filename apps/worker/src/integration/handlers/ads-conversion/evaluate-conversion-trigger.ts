import {
  adsConversionService,
  withBlockedOwnerGuard,
} from "@inboxos.io/business"
import type { AdsConversionJobEvaluateConversionTrigger } from "@inboxos.io/worker-config"

type EvaluateConversionTriggerData =
  AdsConversionJobEvaluateConversionTrigger["data"]

export async function handleEvaluateConversionTrigger(
  data: EvaluateConversionTriggerData,
): Promise<void> {
  await withBlockedOwnerGuard(data.workspaceId, async () => {
    await adsConversionService.evaluateConversionTrigger(data)
  })
}
