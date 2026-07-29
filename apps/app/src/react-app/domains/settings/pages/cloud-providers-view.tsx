/** @jsxImportSource react */
import * as React from "react";
import { toast } from "@/components/ui/sonner";

import type { CloudImportedProvider } from "@/app/cloud/import-state";
import type { DenOrgLlmProvider } from "@/app/lib/den";
import { toChineseUserMessage } from "@/app/lib/user-facing-error";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { t } from "@/i18n";
import { getCloudManagedProviderId } from "@/react-app/domains/connections/provider-auth/cloud-provider-config";
import { useCloudSession } from "@/react-app/domains/settings/cloud/cloud-session-provider";
import { CloudProvidersSection, type CloudProviderRow } from "@/react-app/domains/settings/cloud/sections";
import type { useDenSession } from "@/react-app/domains/settings/cloud/use-den-session";
import { SettingsNotice, SettingsStack } from "@/react-app/domains/settings/settings-section";
import { requestOpenModelPicker } from "@/react-app/shell/new-providers-listener";

type CloudProvidersSession = Pick<
  ReturnType<typeof useDenSession>,
  "syncCurrentDenSettings"
>;
type ProviderActionKind = "import" | "remove" | "sync";

export type CloudProvidersViewProps = {
  cloudOrgProviders: DenOrgLlmProvider[];
  connectCloudProvider: (cloudProviderId: string) => Promise<string | void>;
  embedded?: boolean;
  importedCloudProviders: Record<string, CloudImportedProvider>;
  onOpenAccount: () => void;
  refreshCloudOrgProviders: (options?: { force?: boolean }) => Promise<DenOrgLlmProvider[]>;
  refreshImportedCloudProviders: () => Promise<Record<string, CloudImportedProvider>>;
  removeCloudProvider: (cloudProviderId: string) => Promise<string | void>;
  session: CloudProvidersSession;
};

const sortStrings = (values: string[]) => values.toSorted();

const sameStringList = (a: string[], b: string[]) =>
  a.length === b.length && a.every((value, index) => value === b[index]);

export function buildCompanyProviderImportGuide(providerName: string) {
  const name = providerName.trim() || "公司模型服务";
  return {
    title: `${name} 已导入并连接到当前工作区`,
    description: "下一步请选择其中的模型，即可开始对话。",
    actionLabel: "选择公司模型",
  };
}

export function CloudProvidersView({
  cloudOrgProviders,
  connectCloudProvider,
  embedded = false,
  importedCloudProviders,
  onOpenAccount,
  refreshCloudOrgProviders,
  refreshImportedCloudProviders,
  removeCloudProvider,
  session,
}: CloudProvidersViewProps) {
  const { activeOrganization: activeOrg, authToken, isSignedIn, user } = useCloudSession();
  const [busy, setBusy] = React.useState(false);
  const [actionId, setActionId] = React.useState<string | null>(null);
  const [actionKind, setActionKind] = React.useState<ProviderActionKind | null>(null);
  const [actionError, setActionError] = React.useState<string | null>(null);
  const activeOrgId = activeOrg?.id ?? "";

  const rows = React.useMemo<CloudProviderRow[]>(() => {
    const nextRows: CloudProviderRow[] = cloudOrgProviders.map((provider) => {
      const imported = importedCloudProviders[provider.id] ?? null;
      const status = !imported
        ? "available"
        : imported.providerId !== provider.id.trim() ||
            imported.sourceProviderId !== provider.providerId ||
            (imported.source ?? null) !== (provider.source ?? null) ||
            (imported.updatedAt ?? null) !== (provider.updatedAt ?? null) ||
            !sameStringList(imported.modelIds, sortStrings(provider.models.map((model) => model.id)))
          ? "out_of_sync"
          : "imported";
      return {
        key: `live:${provider.id}`,
        cloudProviderId: provider.id,
        provider,
        imported,
        status,
        name: provider.name,
      };
    });

    for (const imported of Object.values(importedCloudProviders)) {
      if (cloudOrgProviders.some((provider) => provider.id === imported.cloudProviderId)) continue;
      nextRows.push({
        key: `imported:${imported.cloudProviderId}`,
        cloudProviderId: imported.cloudProviderId,
        provider: null,
        imported,
        status: "removed_from_cloud",
        name: imported.name,
      });
    }

    return nextRows;
  }, [cloudOrgProviders, importedCloudProviders]);

  const refresh = React.useCallback(
    async (quiet = false) => {
      if (!authToken.trim() || !activeOrgId) return;

      setBusy(true);
      setActionError(null);

      try {
        session.syncCurrentDenSettings();
        const [items] = await Promise.all([
          refreshCloudOrgProviders({ force: !quiet }),
          refreshImportedCloudProviders(),
        ]);
        if (!quiet) {
          toast.info(
            items.length > 0
              ? `已为 ${activeOrg?.name ?? t("den.active_org_title")} 加载 ${items.length} 个公司模型供应商。`
              : `${activeOrg?.name ?? t("den.active_org_title")} 暂无可用的公司模型供应商。`,
          );
        }
      } catch (error) {
        if (!quiet) {
          setActionError(toChineseUserMessage(error, "无法加载公司模型供应商，请稍后重试。"));
        }
      } finally {
        setBusy(false);
      }
    },
    [
      refreshCloudOrgProviders,
      refreshImportedCloudProviders,
      activeOrg,
      activeOrgId,
      authToken,
      session.syncCurrentDenSettings,
    ],
  );

  React.useEffect(() => {
    if (!user || !activeOrgId) return;
    void refresh(true);
  }, [activeOrgId, refresh, user]);

  const importProvider = React.useCallback(
    async (cloudProviderId: string, providerName: string) => {
      if (actionId) return;

      setActionId(cloudProviderId);
      setActionKind("import");
      setActionError(null);

      try {
        await connectCloudProvider(cloudProviderId);
        const provider = cloudOrgProviders.find((item) => item.id === cloudProviderId);
        const guide = buildCompanyProviderImportGuide(providerName);
        toast.success(guide.title, {
          description: guide.description,
          duration: 12_000,
          action: {
            label: guide.actionLabel,
            onClick: () => requestOpenModelPicker([
              provider ? getCloudManagedProviderId(provider) : cloudProviderId,
            ]),
          },
        });
      } catch (error) {
        setActionError(
          toChineseUserMessage(error, t("den.import_provider_failed", { name: providerName })),
        );
      } finally {
        setActionId(null);
        setActionKind(null);
      }
    },
    [actionId, cloudOrgProviders, connectCloudProvider],
  );

  const removeProvider = React.useCallback(
    async (cloudProviderId: string, providerName: string) => {
      if (actionId) return;

      setActionId(cloudProviderId);
      setActionKind("remove");
      setActionError(null);

      try {
        const message = await removeCloudProvider(cloudProviderId);
        toast.success(message || t("den.removed_provider", { name: providerName }));
      } catch (error) {
        setActionError(
          toChineseUserMessage(error, t("den.remove_provider_failed", { name: providerName })),
        );
      } finally {
        setActionId(null);
        setActionKind(null);
      }
    },
    [actionId, removeCloudProvider],
  );

  const syncProvider = React.useCallback(
    async (cloudProviderId: string, providerName: string) => {
      if (actionId) return;

      setActionId(cloudProviderId);
      setActionKind("sync");
      setActionError(null);

      try {
        await connectCloudProvider(cloudProviderId);
        toast.success(t("den.synced_provider", { name: providerName }));
      } catch (error) {
        setActionError(
          toChineseUserMessage(error, t("den.sync_provider_failed", { name: providerName })),
        );
      } finally {
        setActionId(null);
        setActionKind(null);
      }
    },
    [actionId, connectCloudProvider],
  );

  const useProvider = React.useCallback(
    (cloudProviderId: string) => {
      const provider = cloudOrgProviders.find((item) => item.id === cloudProviderId);
      requestOpenModelPicker([
        provider ? getCloudManagedProviderId(provider) : cloudProviderId,
      ]);
    },
    [cloudOrgProviders],
  );

  if (!isSignedIn) {
    const notice = (
      <SettingsNotice>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <span>{t("skills.share_team_sign_in_hint")}</span>
          <Button size="sm" onClick={onOpenAccount}>
            {t("skills.share_team_sign_in")}
          </Button>
        </div>
      </SettingsNotice>
    );
    return embedded ? notice : (
      <SettingsStack>
        <Separator />
        {notice}
      </SettingsStack>
    );
  }

  const section = (
    <CloudProvidersSection
      actionError={actionError}
      actionId={actionId}
      actionKind={actionKind}
      busy={busy}
      rows={rows}
      onImport={importProvider}
      onRefresh={refresh}
      onRemove={undefined}
      onSync={syncProvider}
      onUse={useProvider}
    />
  );

  return embedded ? section : (
    <SettingsStack>
      <Separator />
      {section}
    </SettingsStack>
  );
}
