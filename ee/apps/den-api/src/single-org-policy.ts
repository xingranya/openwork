export function isSingleOrgOwnerEmailEligible(input: {
  email: string | null | undefined
  ownerEmails: readonly string[]
}) {
  if (input.ownerEmails.length === 0) {
    // 单组织部署必须显式配置首位管理员邮箱；空白白名单不能把任意首个注册者变成所有者。
    return false
  }
  const normalizedEmail = input.email?.trim().toLowerCase()
  return !!normalizedEmail && input.ownerEmails.includes(normalizedEmail)
}

export function resolveSingleOrgMembershipRole(input: {
  activeOwnerCount: number
  email: string | null | undefined
  ownerEmails: readonly string[]
}) {
  if (input.activeOwnerCount > 0) {
    return "member"
  }

  if (!isSingleOrgOwnerEmailEligible({
    email: input.email,
    ownerEmails: input.ownerEmails,
  })) {
    return null
  }

  return "owner"
}
