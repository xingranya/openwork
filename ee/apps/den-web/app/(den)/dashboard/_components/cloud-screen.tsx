"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, Cloud, ExternalLink, Loader2, RefreshCw } from "lucide-react";
import { DenButton } from "../../_components/ui/button";
import { DashboardPageTemplate } from "../../_components/ui/dashboard-page-template";
import { getErrorMessage, requestJson } from "../../_lib/den-flow";
import { useOrgDashboard } from "../_providers/org-dashboard-provider";

type CloudInstanceStatus = "provisioning" | "waking" | "ready" | "failed";

type CloudInstance = {
  status: CloudInstanceStatus;
  url: string | null;
};

const CLOUD_POLL_MS = 5000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseCloudInstance(payload: unknown): CloudInstance | null {
  if (!isRecord(payload)) {
    return null;
  }

  const status = payload.status;
  if (status !== "provisioning" && status !== "waking" && status !== "ready" && status !== "failed") {
    return null;
  }

  const url = typeof payload.url === "string" ? payload.url : null;
  if (status === "ready" && !url) {
    return null;
  }

  return { status, url };
}

function openCloudTab(url: string) {
  const opened = window.open(url, "_blank");
  if (opened) {
    opened.opener = null;
  }
  return Boolean(opened);
}

export function CloudScreen() {
  const { orgContext } = useOrgDashboard();
  const organizationId = orgContext?.organization.id ?? null;
  const [instance, setInstance] = useState<CloudInstance | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [openedUrl, setOpenedUrl] = useState<string | null>(null);
  const [autoOpenBlocked, setAutoOpenBlocked] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    if (!organizationId) {
      return;
    }

    let cancelled = false;
    let pollTimer: ReturnType<typeof setTimeout> | null = null;

    async function loadInstance() {
      setLoading(true);
      setError(null);
      setUnavailable(false);

      try {
        const { response, payload } = await requestJson("/v1/cloud/instance", { method: "GET" }, 20000);
        if (cancelled) {
          return;
        }

        if (response.status === 404) {
          setInstance(null);
          setUnavailable(true);
          return;
        }

        if (!response.ok) {
          throw new Error(getErrorMessage(payload, `云端工作区启动失败（${response.status}）。`));
        }

        const parsed = parseCloudInstance(payload);
        if (!parsed) {
          throw new Error("公司服务返回的云端工作区信息不完整。");
        }

        setInstance(parsed);
        if (parsed.status === "provisioning" || parsed.status === "waking") {
          pollTimer = setTimeout(() => void loadInstance(), CLOUD_POLL_MS);
        }
      } catch (loadError) {
        if (!cancelled) {
          setInstance(null);
          setError(loadError instanceof Error ? loadError.message : "云端工作区启动失败。");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadInstance();

    return () => {
      cancelled = true;
      if (pollTimer) {
        clearTimeout(pollTimer);
      }
    };
  }, [organizationId, refreshKey]);

  useEffect(() => {
    if (instance?.status !== "ready" || !instance.url || openedUrl === instance.url) {
      return;
    }

    setOpenedUrl(instance.url);
    setAutoOpenBlocked(!openCloudTab(instance.url));
  }, [instance, openedUrl]);

  function retry() {
    setOpenedUrl(null);
    setAutoOpenBlocked(false);
    setRefreshKey((value) => value + 1);
  }

  function openReadyCloud() {
    if (instance?.status !== "ready" || !instance.url) {
      return;
    }

    setOpenedUrl(instance.url);
    setAutoOpenBlocked(!openCloudTab(instance.url));
  }

  const readyUrl = instance?.status === "ready" ? instance.url : null;
  const failed = instance?.status === "failed";
  const waking = instance?.status === "waking";
  const starting = !readyUrl && !failed && !error && !unavailable && (loading || instance?.status === "provisioning" || waking);

  return (
    <DashboardPageTemplate
      icon={Cloud}
      badgeLabel="测试版"
      title="云端工作区"
      description="在浏览器中打开公司的完整远程工作区，无需另行安装。"
      colors={["#EFF6FF", "#0F172A", "#2563EB", "#BAE6FD"]}
    >
      <section className="rounded-3xl border border-gray-100 bg-white p-6 shadow-[0_18px_45px_-35px_rgba(15,23,42,0.35)]">
        <div className="flex items-start gap-4">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-700">
            {starting ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
            {readyUrl ? <ExternalLink className="size-5" aria-hidden="true" /> : null}
            {failed || error || unavailable ? <AlertTriangle className="size-5" aria-hidden="true" /> : null}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-blue-700">云端工作区测试版</p>

            {starting ? (
              <>
                <p className="mt-2 text-[15px] font-medium text-gray-950">{waking ? "正在唤醒云端工作区..." : "正在启动云端工作区"}</p>
                <p className="mt-2 text-[13px] leading-6 text-gray-500">
                  {waking
                    ? "正在重新启动你已有的云端工作区，通常只需几秒。"
                    : "正在为公司启动完整的远程工作区，通常只需几秒。"}
                </p>
                <p className="mt-2 text-[13px] leading-6 text-gray-500">
                  请保持此页面打开。工作区准备好后会自动在新标签页中打开。
                </p>
              </>
            ) : null}

            {readyUrl ? (
              <>
                <p className="mt-2 text-[15px] font-medium text-gray-950">云端工作区已就绪</p>
                <p className="mt-2 text-[13px] leading-6 text-gray-500">
                  {autoOpenBlocked
                    ? "浏览器阻止了新标签页，请点击“打开云端工作区”继续。"
                    : "云端工作区已在新标签页中打开。如果没有看到，可以在这里再次打开。"}
                </p>
                <p className="mt-2 text-[13px] leading-6 text-gray-500">
                  此工作区地址包含访问凭据，请勿转发或粘贴到公开位置。
                </p>
                <div className="mt-5 flex flex-wrap gap-3">
                  <DenButton icon={ExternalLink} onClick={openReadyCloud}>打开云端工作区</DenButton>
                  <DenButton variant="secondary" icon={RefreshCw} onClick={retry}>刷新状态</DenButton>
                </div>
              </>
            ) : null}

            {failed ? (
              <>
                <p className="mt-2 text-[15px] font-medium text-gray-950">云端工作区启动失败</p>
                <p className="mt-2 text-[13px] leading-6 text-gray-500">
                  请联系公司管理员检查云端工作区配置，然后重试。
                </p>
                <div className="mt-5">
                  <DenButton variant="secondary" icon={RefreshCw} onClick={retry}>重试</DenButton>
                </div>
              </>
            ) : null}

            {unavailable ? (
              <>
                <p className="mt-2 text-[15px] font-medium text-gray-950">云端工作区暂不可用</p>
                <p className="mt-2 text-[13px] leading-6 text-gray-500">
                  请联系公司管理员启用云端工作区并检查服务配置。
                </p>
                <div className="mt-5">
                  <DenButton variant="secondary" icon={RefreshCw} onClick={retry}>重新检查</DenButton>
                </div>
              </>
            ) : null}

            {error ? (
              <>
                <p className="mt-2 text-[15px] font-medium text-gray-950">云端工作区需要处理</p>
                <p className="mt-2 text-[13px] leading-6 text-gray-500">{error}</p>
                <div className="mt-5">
                  <DenButton variant="secondary" icon={RefreshCw} onClick={retry}>重试</DenButton>
                </div>
              </>
            ) : null}
          </div>
        </div>
      </section>
    </DashboardPageTemplate>
  );
}
