import { vi } from "vitest"

export const mockLicenseRepository = (token?: string) => {
  const findTokenByLicenseId = vi.fn().mockResolvedValue(token)
  const upsert = vi.fn()

  vi.doMock("@inboxos.io/database/repositories", () => ({
    licenseRepository: { findTokenByLicenseId, upsert },
  }))

  return { findTokenByLicenseId, upsert }
}
