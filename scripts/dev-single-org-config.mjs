function parseConfiguredEmails(value) {
  return (value || "")
    .split(",")
    .map((email) => email.trim())
    .filter(Boolean)
}

export function validateDevSingleOrgConfig(input) {
  const orgMode = input.orgMode?.trim() || "single_org"
  if (orgMode === "multi_org") {
    return null
  }

  if (parseConfiguredEmails(input.ownerEmails).length === 0) {
    return "单组织启动前必须配置 DEN_SINGLE_ORG_OWNER_EMAILS，指定首位公司所有者邮箱。"
  }

  if (parseConfiguredEmails(input.bootstrapAdminEmails).length === 0) {
    return "单组织启动前必须配置 DEN_BOOTSTRAP_ADMIN_EMAILS，指定后台管理员邮箱。"
  }

  return null
}
