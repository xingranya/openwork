/** @jsxImportSource react */
import { Button } from "@/components/ui/button";
import type { ReactNode } from "react";

import { t } from "@/i18n";
import { isCloudManagedProviderKey } from "@/react-app/domains/connections/provider-auth/cloud-provider-config";
import { ProviderIcon } from "../../../design-system/provider-icon";
import { SettingsNotice, SettingsStatusBadge } from "../settings-section";
import {
  LayoutSection,
  LayoutSectionDescription,
  LayoutSectionHeader,
  LayoutSectionItem,
  LayoutSectionItemFootnote,
  LayoutSectionItemHeader,
  LayoutSectionItemHeaderActions,
  LayoutSectionItemTitle,
  LayoutSectionTitle,
  LayoutStack,
} from "../settings-layout";

export type ConnectedProvider = {
  id: string;
  name: string;
  source?: "env" | "api" | "config" | "custom";
};

export type AiSettingsViewProps = {
  busy: boolean;
  providerAuthBusy: boolean;
  providerStatusLabel: string;
  providerStatusStyle: string;
  providerSummary: string;
  connectedProviders: ConnectedProvider[];
  disconnectingProviderId: string | null;
  providerConnectError: string | null;
  providerDisconnectStatus: string | null;
  providerDisconnectError: string | null;
  onOpenProviderAuth: () => void | Promise<void>;
  onDisconnectProvider: (providerId: string) => void | Promise<void>;
  canDisconnectProvider: (source?: ConnectedProvider["source"]) => boolean;
  canAddProviders: boolean;
  organizationName?: string;
  /** 从公司服务导入的本地模型服务 ID。 */
  cloudProviderIds?: Set<string>;
  cloudProvidersView?: ReactNode;
};

function providerSourceLabel(source?: ConnectedProvider["source"]) {
  if (source === "env") return t("settings.provider_source_env");
  if (source === "api") return t("settings.provider_source_api");
  if (source === "config") return t("settings.provider_source_config");
  if (source === "custom") return t("settings.provider_source_config");
  return null;
}

function providerSourceBadgeClassName(input: { orgManaged: boolean; source?: ConnectedProvider["source"] }) {
  if (input.orgManaged) {
    return "shrink-0 rounded-full border border-blue-6 bg-blue-2 px-2 py-0.5 text-[10px] font-medium text-blue-11";
  }
  if (input.source === "env") {
    return "shrink-0 rounded-full border border-amber-6 bg-amber-2 px-2 py-0.5 text-[10px] font-medium text-amber-11";
  }
  return "shrink-0 rounded-full border border-dls-border bg-dls-sidebar/40 px-2 py-0.5 text-[10px] font-medium text-muted-foreground";
}

function providerStatusTone(label: string): "ready" | "warning" | "neutral" {
  if (label.toLowerCase().includes("connected") || label.includes("已连接")) return "ready";
  if (label.toLowerCase().includes("error") || label.toLowerCase().includes("fail")) return "warning";
  return "neutral";
}

export function employeeFacingProvider(provider: ConnectedProvider) {
  const internalId = provider.id.toLowerCase();
  const isBundledFreeProvider = /open\s*code/i.test(`${provider.id} ${provider.name}`)
    || internalId === "opencode"
    || internalId === "opencodego";
  if (!isBundledFreeProvider) {
    return { name: provider.name, id: provider.id };
  }
  return {
    name: internalId === "opencodego" ? "SeeWayWork 轻量模型" : "SeeWayWork 免费模型",
    id: null,
  };
}

export function AiSettingsView(props: AiSettingsViewProps) {
  const organizationProviderLabel = props.organizationName?.trim() || t("settings.provider_source_organization");

  return (
    <LayoutStack>
      {/* 模型服务 */}
      <LayoutSection>
        <LayoutSectionHeader>
          <LayoutSectionTitle>{t("settings.providers_title")}</LayoutSectionTitle>
          <LayoutSectionDescription>{t("settings.providers_desc")}</LayoutSectionDescription>
        </LayoutSectionHeader>

        <LayoutSectionItem>
          <LayoutSectionItemHeader>
            <LayoutSectionItemTitle>
              {props.providerSummary}
              <SettingsStatusBadge
                tone={providerStatusTone(props.providerStatusLabel)}
                label={props.providerStatusLabel}
              />
            </LayoutSectionItemTitle>
            {props.canAddProviders ? (
              <LayoutSectionItemHeaderActions>
                <Button
                  onClick={() => void props.onOpenProviderAuth()}
                  disabled={props.busy || props.providerAuthBusy}
                >
                  {props.providerAuthBusy
                    ? t("settings.loading_providers")
                    : t("settings.connect_provider")}
                </Button>
              </LayoutSectionItemHeaderActions>
            ) : null}
          </LayoutSectionItemHeader>
        </LayoutSectionItem>

        {props.connectedProviders.length > 0 ? (
          <div className="space-y-2">
            {props.connectedProviders.map((provider) => {
              const display = employeeFacingProvider(provider);
              return (
                <LayoutSectionItem
                  key={provider.id}
                  className="flex-row flex-wrap items-center justify-between gap-3 rounded-2xl border border-dls-border px-4 py-3"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <ProviderIcon providerId={provider.id} size={20} className="text-dls-text" />
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium text-dls-text">{display.name}</span>
                        {props.cloudProviderIds?.has(provider.id) ? (
                          <span className="shrink-0 rounded-full border border-blue-6 bg-blue-2 px-2 py-0.5 text-[10px] font-medium text-blue-11">
                            公司
                          </span>
                        ) : null}
                        {provider.source === "env" ? (
                          <span className="shrink-0 rounded-full border border-amber-6 bg-amber-2 px-2 py-0.5 text-[10px] font-medium text-amber-11">
                            {providerSourceLabel("env")}
                          </span>
                        ) : null}
                      </div>
                      {display.id ? (
                        <div className="truncate font-mono text-xs text-muted-foreground">{display.id}</div>
                      ) : null}
                    </div>
                  </div>
                  {!props.cloudProviderIds?.has(provider.id) ? (
                    <Button
                      variant="destructive"
                      onClick={() => void props.onDisconnectProvider(provider.id)}
                      disabled={
                        props.busy ||
                        props.providerAuthBusy ||
                        props.disconnectingProviderId !== null ||
                        !props.canDisconnectProvider(provider.source)
                      }
                    >
                      {props.disconnectingProviderId === provider.id
                        ? t("settings.disconnecting")
                        : props.canDisconnectProvider(provider.source)
                          ? t("settings.disconnect")
                          : t("settings.managed_by_env")}
                    </Button>
                  ) : null}
                </LayoutSectionItem>
              );
            })}
          </div>
        ) : null}

        {props.providerConnectError ? (
          <SettingsNotice tone="error">{props.providerConnectError}</SettingsNotice>
        ) : null}
        {props.providerDisconnectStatus ? (
          <SettingsNotice>{props.providerDisconnectStatus}</SettingsNotice>
        ) : null}
        {props.providerDisconnectError ? (
          <SettingsNotice tone="error">{props.providerDisconnectError}</SettingsNotice>
        ) : null}

        <LayoutSectionItemFootnote>{t("settings.api_keys_info")}</LayoutSectionItemFootnote>
      </LayoutSection>

      {props.cloudProvidersView}

    </LayoutStack>
  );
}
