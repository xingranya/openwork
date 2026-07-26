import type { DenOrgMode } from "./env.js"
import { env } from "./env.js"
import {
  getSingletonOrganization,
  isEmailAllowedForOrganization,
  normalizeAllowedEmailDomains,
  OrganizationEmailDomainRestrictionError,
  type AllowedEmailDomains,
} from "./orgs.js"
import { isSingleOrgOwnerEmailEligible } from "./single-org-policy.js"

export type SingleOrgEmailSignupPolicyViolation = {
  error: "single_org_signup_disabled" | "email_domain_restricted" | "single_org_owner_uninitialized"
  message: string
  allowedEmailDomains?: string[]
}

type SingletonOrganizationForSignup = {
  allowedEmailDomains: readonly string[] | null | undefined
}

export function getAuthBodyEmail(body: unknown) {
  if (!body || typeof body !== "object") {
    return null
  }

  const value = Object.getOwnPropertyDescriptor(body, "email")?.value
  return typeof value === "string" && value.trim() ? value.trim() : null
}

export async function getAuthRequestEmail(request: Request) {
  try {
    return getAuthBodyEmail(await request.clone().json())
  } catch {
    return null
  }
}

function disabledSignupViolation(): SingleOrgEmailSignupPolicyViolation {
  return {
    error: "single_org_signup_disabled",
    message: "公司已关闭自助注册，请使用公司单点登录或管理员预先创建的账号。",
  }
}

function domainSignupViolation(email: string, allowedEmailDomains: string[]): SingleOrgEmailSignupPolicyViolation {
  const error = new OrganizationEmailDomainRestrictionError(email, allowedEmailDomains)
  return {
    error: "email_domain_restricted",
    message: error.message,
    allowedEmailDomains,
  }
}

function ownerBootstrapViolation(): SingleOrgEmailSignupPolicyViolation {
  return {
    error: "single_org_owner_uninitialized",
    message: "公司管理员还没有完成首次初始化，请使用预设的管理员邮箱先创建公司账号。",
  }
}

function evaluateAllowedDomains(input: {
  email: string | null
  allowedEmailDomains: AllowedEmailDomains
}) {
  if (!input.allowedEmailDomains || input.allowedEmailDomains.length === 0 || !input.email) {
    return null
  }

  return isEmailAllowedForOrganization(input.allowedEmailDomains, input.email)
    ? null
    : domainSignupViolation(input.email, input.allowedEmailDomains)
}

export async function resolveSingleOrgEmailSignupPolicyViolation(input: {
  orgMode: DenOrgMode
  allowPublicSignup: boolean
  email: string | null
  ownerEmails?: readonly string[]
  getSingletonOrganization: () => Promise<SingletonOrganizationForSignup | null>
}): Promise<SingleOrgEmailSignupPolicyViolation | null> {
  if (input.orgMode !== "single_org") {
    return null
  }

  if (!input.allowPublicSignup) {
    return disabledSignupViolation()
  }

  if (!input.email) {
    return null
  }

  const organization = await input.getSingletonOrganization()
  const ownerEmails = input.ownerEmails ?? []
  if (
    !organization
    && !isSingleOrgOwnerEmailEligible({ email: input.email, ownerEmails })
  ) {
    return ownerBootstrapViolation()
  }
  const allowedEmailDomains = normalizeAllowedEmailDomains(organization?.allowedEmailDomains).domains
  return evaluateAllowedDomains({ email: input.email, allowedEmailDomains })
}

export async function getSingleOrgEmailSignupPolicyViolation(email: string | null) {
  return resolveSingleOrgEmailSignupPolicyViolation({
    orgMode: env.orgMode,
    allowPublicSignup: env.singleOrg.allowPublicSignup,
    email,
    ownerEmails: env.singleOrg.ownerEmails,
    getSingletonOrganization,
  })
}
