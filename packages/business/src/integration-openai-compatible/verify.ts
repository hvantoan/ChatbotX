import ky, { isHTTPError } from "ky"
import { ChatbotXException } from "../errors"
import { validateOpenaiCompatibleBaseUrlForEnvironment } from "./validate-base-url"

const VERIFY_TIMEOUT_MS = 10_000
const UNAUTHORIZED_STATUSES = new Set([401, 403])
const TRAILING_SLASH_REGEX = /\/$/

export type VerifyOpenaiCompatibleProviderResult =
  | { ok: true }
  | {
      ok: false
      reason: "unauthorized"
      status: number
    }
  | {
      ok: false
      reason: "unsafe_base_url"
    }
  | {
      ok: true
      warning: "could_not_verify"
      message: string
    }

export async function verifyOpenaiCompatibleProvider(props: {
  apiKey?: string
  baseURL: string
}): Promise<VerifyOpenaiCompatibleProviderResult> {
  let normalizedBaseUrl: string
  try {
    normalizedBaseUrl = await validateOpenaiCompatibleBaseUrlForEnvironment(
      props.baseURL,
    )
  } catch (error) {
    if (
      error instanceof ChatbotXException &&
      (error.code === "invalidBaseUrl" || error.code === "ssrfBlocked")
    ) {
      return { ok: false, reason: "unsafe_base_url" }
    }
    throw error
  }

  const url = new URL(normalizedBaseUrl)
  url.pathname = `${url.pathname.replace(TRAILING_SLASH_REGEX, "")}/models`

  try {
    const response = await ky.get(url, {
      headers: props.apiKey
        ? { Authorization: `Bearer ${props.apiKey}` }
        : undefined,
      redirect: "manual",
      retry: 0,
      timeout: VERIFY_TIMEOUT_MS,
    })
    if (response.status >= 300 && response.status < 400) {
      return { ok: false, reason: "unsafe_base_url" }
    }
    return { ok: true }
  } catch (error) {
    if (isHTTPError(error)) {
      const { status } = error.response
      if (status >= 300 && status < 400) {
        return { ok: false, reason: "unsafe_base_url" }
      }
      if (UNAUTHORIZED_STATUSES.has(status)) {
        return {
          ok: false,
          reason: "unauthorized",
          status,
        }
      }
      return {
        ok: true,
        warning: "could_not_verify",
        message: "Could not verify provider",
      }
    }
    return {
      ok: true,
      warning: "could_not_verify",
      message: "Could not verify provider",
    }
  }
}
