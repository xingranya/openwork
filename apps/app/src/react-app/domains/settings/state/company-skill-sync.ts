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
  action: "remove" | "restore" | "update";
  message: string;
};

export type CompanySkillSyncResult = {
  importedSkills: Record<string, CloudImportedSkill>;
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

function syncFailureMessage(error: unknown) {
  if (error instanceof Error && error.message.trim()) return error.message.trim();
  const message = String(error ?? "").trim();
  return message || "公司技能同步失败";
}

/**
 * 对当前工作区已经安装过的公司技能执行增量同步。
 *
 * 新出现但从未安装的技能只进入公司目录，不会绕过员工的本机授权自动写入；
 * 已安装技能会自动补回、更新，撤权后会删除并清理导入记录。
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
    restored: [],
    updated: [],
    removed: [],
    unchanged: [],
    failed: [],
  };
  if (importedEntries.length === 0) return result;

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
