import {
  readWorkspaceCloudImports,
  withWorkspaceCloudImports,
  type CloudImportedSkill,
} from "../../../../app/cloud/import-state";
import { denSettingsChangedEvent } from "../../../../app/lib/den-session-events";
import type { OpenworkServerClient } from "../../../../app/lib/openwork-server";
import type { DenOrgSkillCard } from "../../../../app/types";

export type CompanySkillInstallState = "available" | "installed" | "update" | "missing_local";
export type CompanySkillImportRecord = {
  installedName: string;
  bundleHash?: string | null;
  updatedAt?: string | null;
};

export function buildCompanySkillInstallPayload(skill: DenOrgSkillCard, overwrite: boolean) {
  return {
    sourceId: `company:${skill.id}`,
    sourceHash: skill.bundleHash,
    bundleHash: skill.bundleHash,
    files: skill.files,
    overwrite,
  };
}

export function getCompanySkillInstallState(
  skill: DenOrgSkillCard,
  imported: CompanySkillImportRecord | null | undefined,
  installedNames: ReadonlySet<string>,
): CompanySkillInstallState {
  if (!imported) return "available";
  if (!installedNames.has(imported.installedName)) return "missing_local";
  if (imported.bundleHash) {
    return imported.bundleHash === skill.bundleHash ? "installed" : "update";
  }

  const remoteUpdatedAt = skill.updatedAt ? Date.parse(skill.updatedAt) : Number.NaN;
  const importedUpdatedAt = imported.updatedAt ? Date.parse(imported.updatedAt) : Number.NaN;
  return Number.isFinite(remoteUpdatedAt)
    && (!Number.isFinite(importedUpdatedAt) || remoteUpdatedAt > importedUpdatedAt)
    ? "update"
    : "installed";
}

export function getRevokedCompanySkillImports(
  availableSkills: readonly DenOrgSkillCard[],
  importedSkills: Readonly<Record<string, CloudImportedSkill>>,
): CloudImportedSkill[] {
  const availableIds = new Set(availableSkills.map((skill) => skill.id));
  return Object.values(importedSkills).filter((imported) => !availableIds.has(imported.cloudSkillId));
}

type CompanySkillWorkspaceClient = Pick<
  OpenworkServerClient,
  "deleteSkill" | "getConfig" | "installCatalogSkill" | "listSkills" | "patchConfig"
>;

export type CompanySkillSyncFailure = {
  cloudSkillId: string;
  installedName: string;
  action: "install" | "remove" | "restore" | "update";
  message: string;
};

export type CompanySkillSyncResult = {
  importedSkills: Record<string, CloudImportedSkill>;
  installed: string[];
  restored: string[];
  updated: string[];
  removed: string[];
  unchanged: string[];
  failed: CompanySkillSyncFailure[];
};

function companySkillImportRecord(
  skill: DenOrgSkillCard,
  imported: CloudImportedSkill,
  now: () => number,
): CloudImportedSkill {
  return {
    cloudSkillId: skill.id,
    installedName: imported.installedName,
    title: skill.title,
    description: skill.description,
    shared: skill.shared,
    bundleHash: skill.bundleHash,
    updatedAt: skill.updatedAt,
    importedAt: imported.importedAt ?? now(),
  };
}

function newCompanySkillImportRecord(
  skill: DenOrgSkillCard,
  installedName: string,
  now: () => number,
): CloudImportedSkill {
  return {
    cloudSkillId: skill.id,
    installedName,
    title: skill.title,
    description: skill.description,
    shared: skill.shared,
    bundleHash: skill.bundleHash,
    updatedAt: skill.updatedAt,
    importedAt: now(),
  };
}

const COMPANY_SKILL_NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function slugifyCompanySkillName(title: string): string {
  let base = title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!base) base = "skill";
  if (base.length > 64) base = base.slice(0, 64).replace(/-+$/g, "");
  return COMPANY_SKILL_NAME_RE.test(base) ? base : "skill";
}

/**
 * 公司技能以稳定名称安装，避免不同工作区或重复同步生成不同目录。
 * 发生重名时用技能 ID 的尾部生成可复现后缀，不覆盖员工已有技能。
 */
export function resolveCompanySkillInstallName(
  skill: Pick<DenOrgSkillCard, "id" | "title">,
  taken: ReadonlySet<string>,
  preferredName?: string | null,
): string {
  const preferred = preferredName?.trim() ?? "";
  if (preferred) return preferred;

  const base = slugifyCompanySkillName(skill.title || skill.id);
  if (!taken.has(base)) return base;

  const suffix = skill.id.toLowerCase().replace(/[^a-z0-9]+/g, "").slice(-8) || "org";
  for (let index = 1; index < 50; index += 1) {
    const extra = `${suffix}${index}`;
    const candidate = `${base.slice(0, Math.max(1, 64 - extra.length - 1))}-${extra}`
      .replace(/^-+|-+$/g, "")
      .slice(0, 64);
    if (COMPANY_SKILL_NAME_RE.test(candidate) && !taken.has(candidate)) return candidate;
  }
  return `skill-${suffix}`.slice(0, 64);
}

function syncFailureMessage(error: unknown) {
  if (error instanceof Error && error.message.trim()) return error.message.trim();
  const message = String(error ?? "").trim();
  return message || "公司技能同步失败";
}

/**
 * 对当前账号可用的公司技能执行增量同步。
 *
 * 公司管理员下发的新技能会自动安装；已安装技能会自动补回、更新，
 * 撤权后会删除工作区文件并清理导入记录。
 */
export async function reconcileImportedCompanySkills(input: {
  availableSkills: readonly DenOrgSkillCard[];
  openworkClient: CompanySkillWorkspaceClient;
  workspaceId: string;
  includeGlobal: boolean;
  now?: () => number;
}): Promise<CompanySkillSyncResult> {
  const workspaceId = input.workspaceId.trim();
  if (!workspaceId) {
    throw new Error("当前工作区暂时不可用，无法同步公司技能。");
  }

  const configResponse = await input.openworkClient.getConfig(workspaceId);
  const openworkConfig = configResponse.openwork ?? {};
  const cloudImports = readWorkspaceCloudImports(openworkConfig);
  const currentImports = cloudImports.skills;
  const importedEntries = Object.values(currentImports);
  const result: CompanySkillSyncResult = {
    importedSkills: currentImports,
    installed: [],
    restored: [],
    updated: [],
    removed: [],
    unchanged: [],
    failed: [],
  };
  const availableById = new Map(input.availableSkills.map((skill) => [skill.id, skill]));
  const listed = await input.openworkClient.listSkills(workspaceId, {
    includeGlobal: input.includeGlobal,
  });
  const installedNames = new Set(listed.items.map((skill) => skill.name));
  const nextImports = { ...currentImports };
  const now = input.now ?? Date.now;
  let importsChanged = false;

  for (const imported of importedEntries) {
    const available = availableById.get(imported.cloudSkillId);
    if (!available) {
      try {
        if (installedNames.has(imported.installedName)) {
          await input.openworkClient.deleteSkill(workspaceId, imported.installedName);
          installedNames.delete(imported.installedName);
        }
        delete nextImports[imported.cloudSkillId];
        importsChanged = true;
        result.removed.push(imported.installedName);
      } catch (error) {
        result.failed.push({
          cloudSkillId: imported.cloudSkillId,
          installedName: imported.installedName,
          action: "remove",
          message: syncFailureMessage(error),
        });
      }
      continue;
    }

    const state = getCompanySkillInstallState(available, imported, installedNames);
    if (state === "installed") {
      result.unchanged.push(imported.installedName);
      continue;
    }

    const action = state === "update" ? "update" : "restore";
    try {
      await input.openworkClient.installCatalogSkill(
        workspaceId,
        imported.installedName,
        buildCompanySkillInstallPayload(available, state === "update"),
      );
      installedNames.add(imported.installedName);
      nextImports[imported.cloudSkillId] = companySkillImportRecord(available, imported, now);
      importsChanged = true;
      result[action === "update" ? "updated" : "restored"].push(imported.installedName);
    } catch (error) {
      result.failed.push({
        cloudSkillId: imported.cloudSkillId,
        installedName: imported.installedName,
        action,
        message: syncFailureMessage(error),
      });
    }
  }

  // Den 已按成员与团队完成权限过滤；这里把当前账号新获得的公司技能
  // 写入当前工作区，保证新员工首次登录即可直接使用。
  for (const skill of [...input.availableSkills].toSorted((left, right) => left.id.localeCompare(right.id))) {
    if (nextImports[skill.id]) continue;

    const installedName = resolveCompanySkillInstallName(skill, installedNames);
    try {
      await input.openworkClient.installCatalogSkill(
        workspaceId,
        installedName,
        buildCompanySkillInstallPayload(skill, false),
      );
      installedNames.add(installedName);
      nextImports[skill.id] = newCompanySkillImportRecord(skill, installedName, now);
      importsChanged = true;
      result.installed.push(installedName);
    } catch (error) {
      result.failed.push({
        cloudSkillId: skill.id,
        installedName,
        action: "install",
        message: syncFailureMessage(error),
      });
    }
  }

  if (importsChanged) {
    await input.openworkClient.patchConfig(workspaceId, {
      openwork: withWorkspaceCloudImports(openworkConfig, {
        ...cloudImports,
        skills: nextImports,
      }),
    });
  }

  result.importedSkills = nextImports;
  return result;
}

export type CompanySkillSyncReason =
  | "sign_in"
  | "network_recovered"
  | "app_resume";

export function subscribeCompanySkillSyncTriggers(input: {
  windowTarget: EventTarget;
  documentTarget: EventTarget;
  isDocumentVisible: () => boolean;
  sync: (reason: CompanySkillSyncReason) => void;
}) {
  const handleSignIn = () => input.sync("sign_in");
  const handleOnline = () => input.sync("network_recovered");
  const handleResume = () => input.sync("app_resume");
  const handleVisibilityChange = () => {
    if (input.isDocumentVisible()) handleResume();
  };

  input.windowTarget.addEventListener(denSettingsChangedEvent, handleSignIn);
  input.windowTarget.addEventListener("online", handleOnline);
  input.windowTarget.addEventListener("focus", handleResume);
  input.documentTarget.addEventListener("visibilitychange", handleVisibilityChange);

  return () => {
    input.windowTarget.removeEventListener(denSettingsChangedEvent, handleSignIn);
    input.windowTarget.removeEventListener("online", handleOnline);
    input.windowTarget.removeEventListener("focus", handleResume);
    input.documentTarget.removeEventListener("visibilitychange", handleVisibilityChange);
  };
}
