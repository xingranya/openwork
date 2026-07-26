import { createDenClient, readDenSettings, writeDenSettings } from "./den";

export async function saveInstalledSkillToOpenWorkOrg(input: {
  skillText: string;
  shared?: "org" | "public" | null;
}): Promise<{ skillId: string; orgId: string; orgName: string }> {
  const settings = readDenSettings();
  const token = settings.authToken?.trim() ?? "";
  if (!token) {
    throw new Error("请先在设置中登录公司账号，再将技能共享给团队。");
  }

  const cloudClient = createDenClient({ baseUrl: settings.baseUrl, token });
  let orgId = settings.activeOrgId?.trim() ?? "";
  let orgSlug = settings.activeOrgSlug?.trim() ?? "";
  let orgName = settings.activeOrgName?.trim() ?? "";

  if (!orgSlug || !orgName || !orgId) {
    const response = await cloudClient.listOrgs();
    const match = orgId
      ? response.orgs.find((org) => org.id === orgId)
      : response.orgs.find((org) => org.slug === orgSlug) ?? response.orgs[0];
    if (!match) {
      throw new Error("请先在设置中选择公司，再将技能共享给团队。");
    }
    orgId = match.id;
    orgSlug = match.slug;
    orgName = match.name;
    writeDenSettings({
      ...settings,
      baseUrl: settings.baseUrl,
      authToken: token,
      activeOrgId: orgId,
      activeOrgSlug: orgSlug,
      activeOrgName: orgName,
    });
  }

  const created = await cloudClient.createOrgSkill(orgId, {
    skillText: input.skillText,
    shared: input.shared === undefined ? null : input.shared,
  });

  return { skillId: created.id, orgId, orgName };
}
