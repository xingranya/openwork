import { useEffect, useState } from "react";

import {
  createDenClient,
  readDenSettings,
  type DenClient,
} from "../../../../app/lib/den";
import { recordInspectorEvent } from "../../../../app/lib/app-inspector";
import type { OpenworkServerClient } from "../../../../app/lib/openwork-server";
import type { DenAuthStatus } from "../../cloud/den-auth-provider";
import {
  reconcileImportedCompanySkills,
  subscribeCompanySkillSyncTriggers,
  type CompanySkillSyncReason,
  type CompanySkillSyncResult,
} from "./company-skill-sync";

export const COMPANY_SKILL_SYNC_INTERVAL_MS = 5 * 60 * 1000;

type CompanySkillDenClient = Pick<DenClient, "listOrgSkills">;
type CompanySkillOpenworkClient = Pick<
  OpenworkServerClient,
  "baseUrl" | "deleteSkill" | "getConfig" | "installCatalogSkill" | "listSkills" | "patchConfig"
>;

export type CompanySkillBackgroundSyncResult = {
  outcome: "synced" | "unchanged" | "failed" | "skipped";
  result: CompanySkillSyncResult | null;
  reason?: "checking" | "company_unavailable" | "missing_company" | "missing_workspace";
};

export async function syncCompanySkillsInBackground(input: {
  authStatus: DenAuthStatus;
  denClient: CompanySkillDenClient | null;
  orgId: string | null;
  openworkClient: CompanySkillOpenworkClient | null;
  workspaceId: string | null;
  includeGlobal: boolean;
}): Promise<CompanySkillBackgroundSyncResult> {
  const workspaceId = input.workspaceId?.trim() ?? "";
  if (!input.openworkClient || !workspaceId) {
    return { outcome: "skipped", result: null, reason: "missing_workspace" };
  }
  if (input.authStatus === "checking") {
    return { outcome: "skipped", result: null, reason: "checking" };
  }
  if (input.authStatus === "unavailable") {
    return { outcome: "skipped", result: null, reason: "company_unavailable" };
  }

  const orgId = input.orgId?.trim() ?? "";
  if (input.authStatus === "signed_in" && (!input.denClient || !orgId)) {
    return { outcome: "skipped", result: null, reason: "missing_company" };
  }

  const availableSkills = input.authStatus === "signed_in"
    ? await input.denClient!.listOrgSkills(orgId)
    : [];
  const result = await reconcileImportedCompanySkills({
    availableSkills,
    openworkClient: input.openworkClient,
    workspaceId,
    includeGlobal: input.includeGlobal,
  });
  const changed = result.restored.length + result.updated.length + result.removed.length;
  return {
    outcome: result.failed.length > 0 ? "failed" : changed > 0 ? "synced" : "unchanged",
    result,
  };
}

export type CompanySkillAutoSyncState = {
  status: "idle" | "checking" | "ready" | "failed";
  failedCount: number;
};

const IDLE_COMPANY_SKILL_SYNC_STATE: CompanySkillAutoSyncState = {
  status: "idle",
  failedCount: 0,
};

const syncInFlight = new Map<string, Promise<CompanySkillBackgroundSyncResult>>();

function runCoalescedCompanySkillSync(
  key: string,
  task: () => Promise<CompanySkillBackgroundSyncResult>,
) {
  const running = syncInFlight.get(key);
  if (running) return running;
  const next = task().finally(() => {
    if (syncInFlight.get(key) === next) syncInFlight.delete(key);
  });
  syncInFlight.set(key, next);
  return next;
}

/**
 * 在会话主界面维护已安装的公司技能，不要求员工先打开“技能”页面。
 */
export function useCompanySkillAutoSync(input: {
  authStatus: DenAuthStatus;
  openworkClient: CompanySkillOpenworkClient | null;
  workspaceId: string | null;
  workspaceType: "local" | "remote" | null;
  onSkillsChanged?: (result: CompanySkillSyncResult) => void;
}): CompanySkillAutoSyncState {
  const [state, setState] = useState<CompanySkillAutoSyncState>(IDLE_COMPANY_SKILL_SYNC_STATE);

  useEffect(() => {
    const workspaceId = input.workspaceId?.trim() ?? "";
    const client = input.openworkClient;
    if (!client || !workspaceId || input.authStatus === "checking" || input.authStatus === "unavailable") {
      setState(IDLE_COMPANY_SKILL_SYNC_STATE);
      return;
    }

    const settings = readDenSettings();
    const orgId = settings.activeOrgId?.trim() ?? "";
    const key = JSON.stringify([
      client.baseUrl.trim().replace(/\/+$/u, ""),
      workspaceId,
      input.authStatus,
      orgId,
    ]);
    let cancelled = false;

    const tick = async (reason: CompanySkillSyncReason) => {
      if (cancelled) return;
      setState((current) => ({ ...current, status: "checking" }));
      try {
        const currentSettings = readDenSettings();
        const result = await runCoalescedCompanySkillSync(key, () => syncCompanySkillsInBackground({
          authStatus: input.authStatus,
          denClient: input.authStatus === "signed_in"
            ? createDenClient({
                baseUrl: currentSettings.baseUrl,
                token: currentSettings.authToken,
              })
            : null,
          orgId: currentSettings.activeOrgId ?? null,
          openworkClient: client,
          workspaceId,
          includeGlobal: input.workspaceType === "local",
        }));
        if (cancelled) return;
        const failedCount = result.result?.failed.length ?? 0;
        setState({
          status: result.outcome === "failed" ? "failed" : "ready",
          failedCount,
        });
        if (result.result) {
          const changed = result.result.restored.length + result.result.updated.length + result.result.removed.length;
          if (changed > 0) input.onSkillsChanged?.(result.result);
        }
        recordInspectorEvent("company_skills.background_sync", {
          workspaceId,
          reason,
          outcome: result.outcome,
          restored: result.result?.restored.length ?? 0,
          updated: result.result?.updated.length ?? 0,
          removed: result.result?.removed.length ?? 0,
          failed: failedCount,
        });
      } catch (error) {
        if (cancelled) return;
        setState({ status: "failed", failedCount: 1 });
        recordInspectorEvent("company_skills.background_sync", {
          workspaceId,
          reason,
          outcome: "failed",
          message: error instanceof Error ? error.message : String(error),
        });
      }
    };

    void tick("sign_in");
    if (input.authStatus !== "signed_in") {
      return () => {
        cancelled = true;
      };
    }

    const unsubscribe = subscribeCompanySkillSyncTriggers({
      windowTarget: window,
      documentTarget: document,
      isDocumentVisible: () => document.visibilityState === "visible",
      sync: (reason) => {
        void tick(reason);
      },
    });
    const interval = window.setInterval(
      () => void tick("app_resume"),
      COMPANY_SKILL_SYNC_INTERVAL_MS,
    );
    return () => {
      cancelled = true;
      unsubscribe();
      window.clearInterval(interval);
    };
  }, [
    input.authStatus,
    input.onSkillsChanged,
    input.openworkClient,
    input.workspaceId,
    input.workspaceType,
  ]);

  return state;
}
