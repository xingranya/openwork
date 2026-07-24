"use client";

import {
  egressDiagnosticConfigurationSchema,
  egressDiagnosticRunSchema,
  type EgressDiagnosticRun,
  type EgressDiagnosticStep,
} from "@openwork/types/den/egress-diagnostics";
import {
  Activity,
  Check,
  CheckCircle2,
  CircleDashed,
  Copy,
  ExternalLink,
  XCircle,
} from "lucide-react";
import { useEffect, useState } from "react";
import { getErrorMessage, requestJson } from "../../_lib/den-flow";
import { DenButton, buttonVariants } from "../../_components/ui/button";
import { DenCard } from "../../_components/ui/card";
import { DenInput } from "../../_components/ui/input";

function statusStyles(status: EgressDiagnosticStep["status"]) {
  if (status === "passed") return "border-emerald-200 bg-emerald-50 text-emerald-800";
  if (status === "failed") return "border-red-200 bg-red-50 text-red-800";
  return "border-gray-200 bg-gray-50 text-gray-500";
}

function StatusIcon({ status }: { status: EgressDiagnosticStep["status"] }) {
  if (status === "passed") return <CheckCircle2 aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0" />;
  if (status === "failed") return <XCircle aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0" />;
  return <CircleDashed aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0" />;
}

function statusLabel(status: EgressDiagnosticStep["status"]) {
  if (status === "passed") return "通过";
  if (status === "failed") return "失败";
  return "未运行";
}

function ownerLabel(owner: EgressDiagnosticStep["owner"]) {
  if (owner === "network-administrator") return "网络管理员";
  if (owner === "openwork-support") return "OpenWork 技术支持";
  return "Den 运维人员";
}

function StepResult({ step }: { step: EgressDiagnosticStep }) {
  return (
    <li className={`grid gap-3 rounded-[22px] border px-4 py-4 ${statusStyles(step.status)}`}>
      <div className="flex min-w-0 items-start gap-3">
        <StatusIcon status={step.status} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="font-medium">{step.label}</p>
            <span className="text-[12px] font-semibold uppercase tracking-[0.1em]">
              {statusLabel(step.status)} · {step.durationMs} 毫秒
            </span>
          </div>
          <p className="mt-1 text-[13px] opacity-90">{step.message}</p>
        </div>
      </div>
      {step.httpStatuses.length > 0 ? (
        <p className="text-[12px]">
          HTTP 响应：<span className="font-mono">{step.httpStatuses.join(" → ")}</span>
        </p>
      ) : null}
      {step.diagnosticIds.length > 0 ? (
        <div className="grid gap-1 text-[12px]">
          <span>远端诊断编号</span>
          {step.diagnosticIds.map((diagnosticId) => (
            <code className="break-all" key={diagnosticId}>{diagnosticId}</code>
          ))}
        </div>
      ) : null}
      {step.status === "failed" ? (
        <div className="rounded-xl border border-current/15 bg-white/60 px-3 py-3 text-[13px]">
          <p><strong>建议处理人：</strong>{ownerLabel(step.owner)}</p>
          <p className="mt-1"><strong>下一步：</strong>{step.action}</p>
          {step.code ? <p className="mt-1"><strong>故障代码：</strong><code>{step.code}</code></p> : null}
        </div>
      ) : null}
    </li>
  );
}

export function EgressDiagnosticsCard({ canRun }: { canRun: boolean }) {
  const [available, setAvailable] = useState(false);
  const [targetOrigin, setTargetOrigin] = useState<string | null>(null);
  const [missingConfiguration, setMissingConfiguration] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<EgressDiagnosticRun | null>(null);
  const [copied, setCopied] = useState(false);
  const [bearerTokenDraft, setBearerTokenDraft] = useState("");
  const [savingBearerToken, setSavingBearerToken] = useState(false);
  const [editingBearerToken, setEditingBearerToken] = useState(false);

  useEffect(() => {
    if (!canRun) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    async function loadConfiguration() {
      try {
        const { response, payload } = await requestJson("/v1/diagnostics/egress", { method: "GET" }, 12_000);
        if (!response.ok) {
          throw new Error(getErrorMessage(payload, `加载出站连接诊断失败（${response.status}）。`));
        }
        const parsed = egressDiagnosticConfigurationSchema.safeParse(payload);
        if (!parsed.success) throw new Error("Den 返回的诊断配置无效。");
        if (!cancelled) {
          setAvailable(parsed.data.available);
          setTargetOrigin(parsed.data.targetOrigin);
          setMissingConfiguration(parsed.data.missingConfiguration);
          setError(null);
        }
      } catch (loadError) {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : "加载出站连接诊断失败。");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void loadConfiguration();
    return () => { cancelled = true; };
  }, [canRun]);

  useEffect(() => {
    if (!copied) return;
    const timeout = window.setTimeout(() => setCopied(false), 1_600);
    return () => window.clearTimeout(timeout);
  }, [copied]);

  async function runDiagnostic() {
    setRunning(true);
    setError(null);
    setResult(null);
    try {
      const { response, payload } = await requestJson("/v1/diagnostics/egress", { method: "POST" }, 90_000);
      if (!response.ok) {
        throw new Error(getErrorMessage(payload, `启动出站连接诊断失败（${response.status}）。`));
      }
      const parsed = egressDiagnosticRunSchema.safeParse(payload);
      if (!parsed.success) throw new Error("Den 返回的出站连接诊断结果无效。");
      setResult(parsed.data);
    } catch (runError) {
      setError(runError instanceof Error ? runError.message : "出站连接诊断未能完成。");
    } finally {
      setRunning(false);
    }
  }

  async function saveBearerToken() {
    const bearerToken = bearerTokenDraft.trim();
    if (bearerToken.length < 24) {
      setError("诊断令牌至少需要 24 个字符。");
      return;
    }
    setSavingBearerToken(true);
    setError(null);
    try {
      const { response, payload } = await requestJson("/v1/diagnostics/egress/token", {
        method: "PUT",
        body: JSON.stringify({ bearerToken }),
      }, 12_000);
      if (!response.ok) throw new Error(getErrorMessage(payload, `保存诊断令牌失败（${response.status}）。`));
      setBearerTokenDraft("");
      setAvailable(true);
      setMissingConfiguration([]);
      setEditingBearerToken(false);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "保存诊断令牌失败。");
    } finally {
      setSavingBearerToken(false);
    }
  }

  async function copyRunId() {
    if (!result) return;
    await navigator.clipboard.writeText(result.runId);
    setCopied(true);
  }

  return (
    <DenCard size="spacious" className="grid gap-6" data-testid="egress-diagnostics-card">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="grid max-w-[660px] gap-2">
          <p className="text-[12px] font-semibold uppercase tracking-[0.16em] text-gray-400">公司网络支持</p>
          <h2 className="text-[24px] font-semibold tracking-[-0.04em] text-gray-900">Den 出站连接诊断</h2>
          <p className="text-[14px] text-gray-500">
            从当前 Den 进程发起受控连接，检查公司 MCP 使用的 DNS、代理、TLS、防火墙、服务网格和 Kubernetes 出站链路。
          </p>
        </div>
        <DenButton
          type="button"
          icon={Activity}
          loading={running}
          disabled={!canRun || loading || !available}
          onClick={() => void runDiagnostic()}
        >
          运行出站连接诊断
        </DenButton>
      </div>

      <div className="rounded-[22px] border border-gray-200 bg-gray-50 px-4 py-4 text-[13px] text-gray-600">
        <p><strong>固定目标：</strong>{targetOrigin ? <code className="break-all">{targetOrigin}</code> : "未配置"}</p>
        <p className="mt-1">浏览器无法更改此目标。诊断不会发送公司数据、客户凭据或服务商凭据。</p>
      </div>

      {!canRun ? <p className="text-[13px] text-gray-500">只有工作区所有者和管理员可以运行此诊断。</p> : null}
      {loading ? <p className="text-[13px] text-gray-500" role="status">正在加载诊断配置...</p> : null}
      {!loading && canRun && available && !editingBearerToken ? (
        <div className="flex items-center justify-between gap-3 rounded-[22px] border border-gray-200 bg-gray-50 px-4 py-3 text-[13px] text-gray-600">
          <p>Den 已配置诊断令牌。</p>
          <DenButton type="button" size="sm" variant="secondary" onClick={() => setEditingBearerToken(true)}>
            更换令牌
          </DenButton>
        </div>
      ) : null}
      {!loading && canRun && (!available || editingBearerToken) ? (
        <div className="rounded-[22px] border border-amber-200 bg-amber-50 px-4 py-4 text-[13px] text-amber-800" role="status">
          <p className="font-medium">{available ? "更换诊断令牌。" : "请先添加诊断令牌。"}</p>
          <p className="mt-1">Den 会加密保存公司的诊断令牌，保存后不再显示。</p>
          <div className="mt-3 flex flex-wrap items-end gap-2">
            <label className="grid min-w-[280px] flex-1 gap-1">
              <span className="text-[12px] font-medium">诊断 Bearer Token</span>
              <DenInput
                autoComplete="new-password"
                minLength={24}
                onChange={(event) => setBearerTokenDraft(event.target.value)}
                placeholder="粘贴合成诊断令牌"
                type="password"
                value={bearerTokenDraft}
              />
            </label>
            <DenButton type="button" loading={savingBearerToken} onClick={() => void saveBearerToken()}>
              保存令牌
            </DenButton>
            {available ? (
              <DenButton type="button" size="sm" variant="secondary" onClick={() => setEditingBearerToken(false)}>
                取消
              </DenButton>
            ) : null}
          </div>
        </div>
      ) : null}
      {error ? <div className="rounded-[22px] border border-red-200 bg-red-50 px-4 py-4 text-[13px] text-red-800" role="alert">{error}</div> : null}

      {result ? (
        <section className="grid gap-4" aria-live="polite">
          <div className={`rounded-[22px] border px-4 py-4 ${result.overallStatus === "passed" ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-red-200 bg-red-50 text-red-800"}`}>
            <p className="font-semibold">{result.overallStatus === "passed" ? "诊断通过。" : `诊断在 ${result.failedStep ?? "未知步骤"} 停止。`}</p>
            <div className="mt-3 flex min-w-0 flex-wrap items-center gap-2">
              <span className="text-[12px]">运行编号</span>
              <code className="min-w-0 break-all text-[12px]">{result.runId}</code>
              <DenButton type="button" size="sm" variant="secondary" icon={copied ? Check : Copy} onClick={() => void copyRunId()}>
                {copied ? "已复制" : "复制"}
              </DenButton>
              <a className={buttonVariants({ variant: "secondary", size: "sm" })} href={result.supportUrl} target="_blank" rel="noreferrer">
                查看支持追踪 <ExternalLink aria-hidden="true" className="h-3.5 w-3.5" />
              </a>
            </div>
          </div>
          <ol className="grid gap-3">
            {result.steps.map((step) => <StepResult key={step.id} step={step} />)}
          </ol>
        </section>
      ) : null}
    </DenCard>
  );
}
