import { InboxOSException } from "../errors"

/**
 * Codes the builder maps to translated messages. The exception `message` is
 * the code itself — never shown raw; `data` carries interpolation params.
 */
export const AUDIENCE_ERROR_CODES = [
  "audienceInvalidFile",
  "audienceTooManyRows",
  "audienceNoIdentifier",
  "audienceNoValidRows",
  "audiencePartialUpload",
  "audienceNotFound",
  "audienceCreateRejected",
  "audienceInUse",
] as const

export type AudienceErrorCode = (typeof AUDIENCE_ERROR_CODES)[number]

export function audienceError(
  code: AudienceErrorCode,
  data?: Record<string, string | number>,
): InboxOSException {
  const error = new InboxOSException(code, code)
  if (data) {
    error.data = data
  }
  return error
}

export function isAudienceError(
  error: unknown,
): error is InboxOSException & { code: AudienceErrorCode } {
  return (
    error instanceof InboxOSException &&
    (AUDIENCE_ERROR_CODES as readonly string[]).includes(error.code)
  )
}
