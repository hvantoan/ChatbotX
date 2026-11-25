import type { SocialProvider } from "@inboxos.io/auth/server"
import {
  isSignUpDisabled,
  resolveGenericOAuthConfig,
  SOCIAL_PROVIDERS,
  warnIfGenericOAuthUnlicensed,
} from "@inboxos.io/auth/server"
import { resolveTenantByDomain } from "@inboxos.io/auth/tenant"
import { hasEnterpriseFeatures } from "@inboxos.io/business"
import { env } from "@/env"
import { resolveInvitationFromCookie } from "@/features/invitations/lib/invitation-cookie"
import { resolveEnabledProvidersForDomain } from "@/lib/auth/auth-instances"
import { getDomainFromHeader } from "@/lib/domain"

export type GenericOAuthButton = {
  displayName: string
  logoUrl?: string
}

/** The IdP button to render, or `null` when unconfigured or unlicensed. */
export const resolveGenericOAuthButton =
  async (): Promise<GenericOAuthButton | null> => {
    const isLicensed = await hasEnterpriseFeatures()
    warnIfGenericOAuthUnlicensed(isLicensed)
    if (!(resolveGenericOAuthConfig() && isLicensed)) {
      return null
    }

    return {
      displayName: env.NEXT_PUBLIC_AUTH_OAUTH_DISPLAY_NAME ?? "SSO",
      logoUrl: env.NEXT_PUBLIC_AUTH_OAUTH_LOGO_URL,
    }
  }

export const resolveAuthPageOptions = async (): Promise<{
  enabledProviders: SocialProvider[]
  genericOAuth: GenericOAuthButton | null
  signUpAllowed: boolean
}> => {
  const domain = await getDomainFromHeader()
  const tenantId = await resolveTenantByDomain(domain)
  const [enabledProviders, genericOAuth, invitation] = await Promise.all([
    resolveEnabledProvidersForDomain(domain, SOCIAL_PROVIDERS),
    resolveGenericOAuthButton(),
    resolveInvitationFromCookie(tenantId),
  ])

  return {
    enabledProviders,
    genericOAuth,
    signUpAllowed: !isSignUpDisabled() || Boolean(invitation),
  }
}
