"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowRight, Check, ChevronDown, Loader2, LockKeyhole, Play, RefreshCw, Wrench } from "lucide-react";
import { DenButton } from "../../_components/ui/button";
import { DenSelect } from "../../_components/ui/select";
import { DenTextarea } from "../../_components/ui/textarea";
import { DenRequestTimeoutError, getErrorMessage } from "../../_lib/den-flow";
import {
  type ExternalMcpConnection,
  type ExternalMcpInspectionBody,
  type ExternalMcpInspectionHeader,
  type ExternalMcpTool,
  type ExternalMcpToolCallInspection,
  ExternalMcpToolRunError,
  useMcpConnectionTools,
  useRunMcpConnectionTool,
} from "./mcp-connections-data";
import {
  attributeExternalMcpToolFailure,
  type ExternalMcpFailureAttribution,
} from "./mcp-tool-error-attribution";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function placeholderValue(definition: unknown): unknown {
  if (!isRecord(definition)) return null;
  if ("default" in definition) return definition.default;
  if (Array.isArray(definition.enum) && definition.enum.length > 0) return definition.enum[0];
  if (definition.type === "string") return "";
  if (definition.type === "integer" || definition.type === "number") return 0;
  if (definition.type === "boolean") return false;
  if (definition.type === "array") return [];
  if (definition.type === "object") return {};
  return null;
}

export function mcpToolArgumentTemplate(tool: ExternalMcpTool): Record<string, unknown> {
  const properties = isRecord(tool.inputSchema.properties) ? tool.inputSchema.properties : {};
  const required = new Set(
    Array.isArray(tool.inputSchema.required)
      ? tool.inputSchema.required.filter((value): value is string => typeof value === "string")
      : [],
  );
  return Object.fromEntries(
    Object.entries(properties)
      .filter(([name]) => required.has(name))
      .map(([name, definition]) => [name, placeholderValue(definition)]),
  );
}

function formatJson(value: unknown): string {
  return JSON.stringify(value, null, 2) ?? "null";
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
}

function InspectionHeaders({ headers }: { headers: ExternalMcpInspectionHeader[] }) {
  if (headers.length === 0) return <p className="text-[11px] text-gray-400">未捕获到请求头。</p>;
  return (
    <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
      {headers.map((header, index) => (
        // set-cookie 等请求头可能重复，不能只用名称作为稳定的 React key。
        <div key={`${index}-${header.name}`} className="grid grid-cols-[minmax(7rem,0.7fr)_minmax(0,1.3fr)] gap-3 border-b border-gray-100 px-3 py-2 last:border-b-0">
          <code className="break-all text-[10px] font-semibold text-gray-600">{header.name}</code>
          <code className="break-all text-[10px] text-gray-800">
            {header.redacted ? <LockKeyhole className="mr-1 inline h-3 w-3 text-amber-600" aria-hidden="true" /> : null}
            {header.value}
          </code>
        </div>
      ))}
    </div>
  );
}

function InspectionBody({ body }: { body: ExternalMcpInspectionBody }) {
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between gap-3 text-[10px] text-gray-500">
        <span>原始正文</span>
        <span>
          {formatBytes(body.bytes)}
          {body.truncated ? <span className="ml-1 font-semibold text-amber-700">· 内容已截断</span> : null}
        </span>
      </div>
      {body.unavailable ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800">无法捕获本次传输的正文。</div>
      ) : (
        <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-gray-950 p-3 text-[10px] leading-4 text-gray-100">{body.text || "（正文为空）"}</pre>
      )}
    </div>
  );
}

function diagnosisLayerLabel(layer: ExternalMcpToolCallInspection["diagnosis"]["layer"]): string {
  if (layer === "openwork") return "SeeWayWork 发送前";
  if (layer === "network") return "网络连接或无响应";
  if (layer === "mcp_connection") return "MCP 连接配置";
  if (layer === "remote_http") return "远程 MCP HTTP 服务";
  return "MCP 工具响应";
}

function confidenceLabel(confidence: ExternalMcpFailureAttribution["confidence"]): string {
  return confidence === "Confirmed" ? "已确认" : "推断";
}

function userFacingError(error: unknown, fallback: string): string {
  return error instanceof Error ? getErrorMessage(error.message, fallback) : fallback;
}

function McpFailureAttribution({
  attribution,
  standalone = false,
}: {
  attribution: ExternalMcpFailureAttribution;
  standalone?: boolean;
}) {
  return (
    <div
      className={`${standalone ? "rounded-2xl border border-red-200" : "border-b border-red-200"} bg-red-50 px-4 py-3`}
      role="alert"
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-red-800">
        <AlertTriangle className="h-4 w-4" aria-hidden="true" />
        <span className="font-semibold">工具调用失败</span>
        <span className="text-red-400">·</span>
        <span>可能原因：<strong>{attribution.likelySource}</strong></span>
        <span className="rounded-full border border-red-200 bg-white/60 px-1.5 py-0.5 text-[10px] font-medium">{confidenceLabel(attribution.confidence)}</span>
      </div>
      <details className="group/attribution mt-2">
        <summary className="inline-flex cursor-pointer list-none items-center gap-1 text-[10px] font-medium text-red-700 [&::-webkit-details-marker]:hidden">
          查看诊断详情
          <ChevronDown className="h-3 w-3 transition-transform group-open/attribution:rotate-180" aria-hidden="true" />
        </summary>
        <p className="mt-2 border-t border-red-200 pt-2 text-[10px] leading-4 text-red-700">{attribution.summary}</p>
        <dl className="mt-2 grid gap-2 text-[10px] sm:grid-cols-2">
          <div>
            <dt className="font-semibold text-red-500">最后确认到达的位置</dt>
            <dd className="mt-0.5 text-gray-800">{attribution.lastConfirmedBoundary}</dd>
          </div>
          <div>
            <dt className="font-semibold text-red-500">处理建议</dt>
            <dd className="mt-0.5 text-gray-800">{attribution.retryGuidance}</dd>
          </div>
        </dl>
        {attribution.diagnosticReference || attribution.providerRequestId || attribution.diagnosticCode ? (
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[9px] text-red-700">
            {attribution.diagnosticReference ? <span>诊断编号：{attribution.diagnosticReference}</span> : null}
            {attribution.providerRequestId ? <span>服务方请求编号：{attribution.providerRequestId}</span> : null}
            {attribution.diagnosticCode ? <span>错误代码：{attribution.diagnosticCode}</span> : null}
          </div>
        ) : null}
      </details>
    </div>
  );
}

function McpToolCallInspector({
  inspection,
  failureAttribution,
}: {
  inspection: ExternalMcpToolCallInspection;
  failureAttribution: ExternalMcpFailureAttribution | null;
}) {
  const succeeded = inspection.diagnosis.status === "succeeded";
  // 即使已捕获请求，也可能在 SeeWayWork 内部被拦截；诊断层负责区分“未发送”和“已发送但无响应”。
  const transportChip = inspection.response
    ? `HTTP ${inspection.response.status}`
    : inspection.request && inspection.diagnosis.layer !== "openwork"
      ? "无响应"
      : "未发送";
  return (
    <section className="overflow-hidden rounded-2xl border border-gray-200 bg-white" aria-label="工具调用检查">
      {succeeded ? (
        <div className="border-b border-emerald-200 bg-emerald-50 px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-[12px] font-semibold text-emerald-800">远程 MCP 已完成调用</p>
            <div className="flex items-center gap-1.5 font-mono text-[10px] text-gray-600">
              <span>SeeWayWork</span><ArrowRight className="h-3 w-3" aria-hidden="true" />
              <span>{transportChip}</span><ArrowRight className="h-3 w-3" aria-hidden="true" />
              <span>工具结果</span>
            </div>
          </div>
          <p className="mt-1 text-[11px] leading-5 text-emerald-700">{getErrorMessage(inspection.diagnosis.summary, "工具调用已成功完成。")}</p>
        </div>
      ) : failureAttribution ? (
        <McpFailureAttribution attribution={failureAttribution} />
      ) : (
        <div className="border-b border-red-200 bg-red-50 px-4 py-3">
          <p className="text-[12px] font-semibold text-red-800">调用中止位置：{diagnosisLayerLabel(inspection.diagnosis.layer)}</p>
          <p className="mt-1 text-[11px] leading-5 text-red-700">{getErrorMessage(inspection.diagnosis.summary, "工具调用未成功，请查看下方诊断信息。")}</p>
        </div>
      )}

      <details className="group/wire">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-[11px] font-medium text-gray-700 transition hover:bg-gray-50 [&::-webkit-details-marker]:hidden">
          <span>检查请求和响应</span>
          <span className="inline-flex items-center gap-2 font-mono text-[10px] text-gray-500">
            {transportChip}
            <ChevronDown className="h-3.5 w-3.5 transition-transform group-open/wire:rotate-180" aria-hidden="true" />
          </span>
        </summary>

        <div className="border-t border-amber-100 bg-amber-50/70 px-4 py-2 text-[10px] leading-4 text-amber-800">
          凭据和会话请求头已隐藏。请求及响应正文可能包含服务方的敏感数据；这些内容只在本次执行中返回，不会写入 SeeWayWork 日志。
        </div>

        <div className="grid gap-0 border-t border-gray-200 xl:grid-cols-2 xl:divide-x xl:divide-gray-200">
          <div className="space-y-4 p-4">
            <div>
              <p className="text-[11px] font-semibold text-gray-500">发出的请求</p>
              {inspection.request ? (
                <div className="mt-2 rounded-lg bg-gray-950 px-3 py-2 font-mono text-[10px] leading-4 text-gray-100">
                  <span className="font-semibold text-blue-300">{inspection.request.method}</span> <span className="break-all">{inspection.request.url}</span>
                </div>
              ) : (
                <p className="mt-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-[11px] text-gray-500">SeeWayWork 未发出工具调用请求。</p>
              )}
            </div>
            {inspection.request ? (
              <>
                <div><p className="mb-1.5 text-[11px] font-medium text-gray-700">请求头</p><InspectionHeaders headers={inspection.request.headers} /></div>
                <InspectionBody body={inspection.request.body} />
              </>
            ) : null}
          </div>

          <div className="space-y-4 border-t border-gray-200 p-4 xl:border-t-0">
            <div>
              <p className="text-[11px] font-semibold text-gray-500">收到的响应</p>
              {inspection.response ? (
                <div className="mt-2 flex items-center justify-between gap-3 rounded-lg bg-gray-950 px-3 py-2 font-mono text-[10px] text-gray-100">
                  <span><span className={inspection.response.status < 400 ? "text-emerald-300" : "text-red-300"}>HTTP {inspection.response.status}</span> {inspection.response.statusText}</span>
                  <span className="text-gray-400">{inspection.response.durationMs} 毫秒</span>
                </div>
              ) : (
                <p className="mt-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-[11px] text-gray-500">未捕获到 HTTP 响应。</p>
              )}
            </div>
            {inspection.response ? (
              <>
                <div><p className="mb-1.5 text-[11px] font-medium text-gray-700">响应头</p><InspectionHeaders headers={inspection.response.headers} /></div>
                <InspectionBody body={inspection.response.body} />
              </>
            ) : null}
          </div>
        </div>
      </details>
    </section>
  );
}

export function McpToolRunner({ connection }: { connection: ExternalMcpConnection }) {
  const catalog = useMcpConnectionTools(connection.id, true);
  const runTool = useRunMcpConnectionTool(connection.id);
  const tools = useMemo(() => catalog.data ?? [], [catalog.data]);
  const [selectedToolName, setSelectedToolName] = useState("");
  const [argumentsText, setArgumentsText] = useState("{}");
  const [localError, setLocalError] = useState<string | null>(null);
  const [destructiveConfirmed, setDestructiveConfirmed] = useState(false);
  const selectedTool = tools.find((tool) => tool.name === selectedToolName) ?? tools[0] ?? null;

  useEffect(() => {
    if (!tools.length || tools.some((tool) => tool.name === selectedToolName)) return;
    const firstTool = tools[0];
    if (!firstTool) return;
    setSelectedToolName(firstTool.name);
    setArgumentsText(formatJson(mcpToolArgumentTemplate(firstTool)));
    setDestructiveConfirmed(false);
  }, [selectedToolName, tools]);

  function selectTool(toolName: string) {
    const tool = tools.find((candidate) => candidate.name === toolName);
    if (!tool) return;
    setSelectedToolName(tool.name);
    setArgumentsText(formatJson(mcpToolArgumentTemplate(tool)));
    setDestructiveConfirmed(false);
    setLocalError(null);
    runTool.reset();
  }

  async function handleRun() {
    if (!selectedTool) return;
    setLocalError(null);
    runTool.reset();

    let parsed: unknown;
    try {
      parsed = JSON.parse(argumentsText);
    } catch {
      setLocalError("参数必须是有效的 JSON。");
      return;
    }
    if (!isRecord(parsed)) {
      setLocalError("参数必须是 JSON 对象，例如 {}。");
      return;
    }
    if (selectedTool.annotations?.destructiveHint && !destructiveConfirmed) {
      setLocalError("请先确认高风险操作提示，再运行此工具。");
      return;
    }

    await runTool.mutateAsync({ toolName: selectedTool.name, arguments: parsed }).catch(() => undefined);
  }

  const inspection = runTool.data?.inspection
    ?? (runTool.error instanceof ExternalMcpToolRunError ? runTool.error.inspection : null);
  const serverFailure = runTool.error instanceof ExternalMcpToolRunError ? runTool.error : null;
  const browserTimeout = runTool.error instanceof DenRequestTimeoutError ? runTool.error : null;
  const failureAttribution = !localError && (serverFailure || browserTimeout)
    ? attributeExternalMcpToolFailure({
        diagnostic: serverFailure?.diagnostic ?? null,
        inspection,
        browserTimeout,
        mayHaveSideEffects: selectedTool?.annotations?.readOnlyHint !== true,
      })
    : null;
  const executionError = localError
    ?? (!failureAttribution && runTool.error instanceof Error
      ? runTool.error.message
      : !failureAttribution && runTool.error
        ? "MCP 工具调用失败。"
        : null);

  return (
    <div className="border-t border-gray-100 bg-gray-50/70 px-6 py-5" data-testid={`mcp-tool-runner-${connection.id}`}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Wrench className="h-4 w-4 text-gray-500" />
            <p className="text-[13px] font-semibold text-gray-900">手动运行工具</p>
          </div>
          <p className="mt-1 max-w-2xl text-[12px] leading-5 text-gray-500">
            SeeWayWork 会使用当前可用的连接凭据执行工具，参数和结果不会写入 SeeWayWork 日志。
          </p>
        </div>
        <DenButton className="shrink-0 whitespace-nowrap" variant="secondary" size="sm" loading={catalog.isFetching} onClick={() => void catalog.refetch()}>
          <RefreshCw className="h-3.5 w-3.5" />
          刷新工具
        </DenButton>
      </div>

      {catalog.isLoading ? (
        <div className="mt-4 flex items-center gap-2 text-[12px] text-gray-500">
          <Loader2 className="h-4 w-4 animate-spin" />
          正在读取 MCP 工具目录…
        </div>
      ) : catalog.error ? (
        <div className="mt-4 rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-[12px] leading-5 text-red-700">
          {userFacingError(catalog.error, "无法读取此 MCP 的工具，请检查连接后重试。")}
        </div>
      ) : tools.length === 0 ? (
        <div className="mt-4 rounded-xl border border-gray-200 bg-white px-4 py-3 text-[12px] text-gray-500">
          此 MCP 已连接，但当前没有提供可用工具。
        </div>
      ) : selectedTool ? (
        <div className="mt-4 space-y-4">
          <div>
            <label className="mb-1.5 block text-[12px] font-medium text-gray-700" htmlFor={`mcp-tool-${connection.id}`}>
              工具
            </label>
            <DenSelect
              id={`mcp-tool-${connection.id}`}
              value={selectedTool.name}
              onChange={(event) => selectTool(event.target.value)}
              disabled={runTool.isPending}
            >
              {tools.map((tool) => (
                <option key={tool.name} value={tool.name}>{tool.title || tool.annotations?.title || tool.name}</option>
              ))}
            </DenSelect>
            <p className="mt-2 font-mono text-[11px] text-gray-500">{selectedTool.name}</p>
            {selectedTool.description ? <p className="mt-1 text-[12px] leading-5 text-gray-600">{selectedTool.description}</p> : null}
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-[12px] font-medium text-gray-700" htmlFor={`mcp-tool-arguments-${connection.id}`}>
                参数（JSON）
              </label>
              <DenTextarea
                id={`mcp-tool-arguments-${connection.id}`}
                className="min-h-56 font-mono text-[12px] leading-5"
                rows={10}
                value={argumentsText}
                onChange={(event) => {
                  setArgumentsText(event.target.value);
                  setLocalError(null);
                  runTool.reset();
                }}
                disabled={runTool.isPending}
                spellCheck={false}
              />
            </div>
            <div>
              <p className="mb-1.5 text-[12px] font-medium text-gray-700">输入结构</p>
              <pre className="max-h-56 overflow-auto rounded-xl bg-gray-950 p-3 text-[10px] leading-4 text-gray-100">{formatJson(selectedTool.inputSchema)}</pre>
            </div>
          </div>

          {selectedTool.annotations?.destructiveHint ? (
            <label className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-[12px] leading-5 text-red-700">
              <input
                type="checkbox"
                className="mt-1"
                checked={destructiveConfirmed}
                onChange={(event) => setDestructiveConfirmed(event.target.checked)}
              />
              <span><strong>高风险操作。</strong>服务方标记此工具可能修改或删除外部数据。我已检查参数并确认运行。</span>
            </label>
          ) : selectedTool.annotations?.readOnlyHint ? (
            <p className="inline-flex items-center gap-1.5 text-[11px] font-medium text-blue-700">
              <Check className="h-3.5 w-3.5" /> 服务方已将此工具标记为只读。
            </p>
          ) : (
            <p className="inline-flex items-center gap-1.5 text-[11px] font-medium text-amber-700">
              <AlertTriangle className="h-3.5 w-3.5" /> 服务方未将此工具标记为只读，请确认参数后再运行。
            </p>
          )}

          {executionError ? (
            <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-[12px] leading-5 text-red-700" role="alert">
              {getErrorMessage(executionError, "MCP 工具调用失败，请检查参数和连接后重试。")}
            </div>
          ) : null}

          <div className="flex items-center gap-3">
            <DenButton
              variant="primary"
              size="sm"
              icon={Play}
              loading={runTool.isPending}
              onClick={() => void handleRun()}
            >
              运行工具
            </DenButton>
            <p className="text-[11px] text-gray-500">将立即在 {connection.name} 上执行。</p>
          </div>

          {inspection ? (
            <McpToolCallInspector inspection={inspection} failureAttribution={failureAttribution} />
          ) : failureAttribution ? (
            <McpFailureAttribution attribution={failureAttribution} standalone />
          ) : null}

          {runTool.data && !runTool.data.inspection ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[12px] leading-5 text-amber-800" role="status">
              工具已完成，但请求和响应详情暂不可用。请确认管理后台与服务器版本一致后刷新页面。
            </div>
          ) : null}

          {runTool.data ? (
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50/70 p-4" role="status">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-emerald-800">
                  <Check className="h-4 w-4" /> 工具已完成
                </p>
                <p className="font-mono text-[10px] text-emerald-700">
                  {runTool.data.referenceId} · {runTool.data.durationMs} 毫秒
                </p>
              </div>
              <pre className="mt-3 max-h-80 overflow-auto rounded-xl bg-gray-950 p-3 text-[10px] leading-4 text-gray-100">{formatJson(runTool.data.result)}</pre>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
