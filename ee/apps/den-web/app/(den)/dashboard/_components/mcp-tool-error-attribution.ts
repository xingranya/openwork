export type ExternalMcpDiagnostic = {
  referenceId?: string;
  phase?: string;
  category?: string;
  code?: string;
  retryable?: boolean;
  actionOwner?: "openwork" | "network_admin" | "provider_admin" | "organization_admin" | "member";
  operatorAction?: string;
  message?: string;
  highestPassed?: "configured" | "reachable" | "authorized" | "protocol_ready" | "catalog_ready" | "operation_ready";
  httpStatus?: number;
  operationPhase?: string;
  providerStatus?: number;
  providerRequestId?: string;
  providerCode?: string;
  connectUrl?: string;
};

type InspectionEvidence = {
  request?: unknown;
  response?: {
    status: number;
    headers?: Array<{ name: string; value: string; redacted: boolean }>;
  };
  diagnosis?: {
    layer?: string;
    summary?: string;
  };
};

type BrowserTimeoutEvidence = {
  timeoutMs: number;
  outcome: "unknown";
};

export type ExternalMcpFailureAttribution = {
  summary: string;
  lastConfirmedBoundary: string;
  likelySource: string;
  confidence: "Confirmed" | "Inferred";
  retryGuidance: string;
  outcome: "failed" | "unknown";
  diagnosticReference?: string;
  providerRequestId?: string;
  diagnosticCode?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function optionalActionOwner(value: unknown): ExternalMcpDiagnostic["actionOwner"] {
  if (
    value === "openwork"
    || value === "network_admin"
    || value === "provider_admin"
    || value === "organization_admin"
    || value === "member"
  ) return value;
  return undefined;
}

function optionalHighestPassed(value: unknown): ExternalMcpDiagnostic["highestPassed"] {
  if (
    value === "configured"
    || value === "reachable"
    || value === "authorized"
    || value === "protocol_ready"
    || value === "catalog_ready"
    || value === "operation_ready"
  ) return value;
  return undefined;
}

export function parseExternalMcpDiagnostic(value: unknown): ExternalMcpDiagnostic | null {
  if (!isRecord(value)) return null;

  const referenceId = optionalString(value.referenceId);
  const phase = optionalString(value.phase);
  const category = optionalString(value.category);
  const code = optionalString(value.code);
  const actionOwner = optionalActionOwner(value.actionOwner);
  const operatorAction = optionalString(value.operatorAction);
  const message = optionalString(value.message);
  const highestPassed = optionalHighestPassed(value.highestPassed);
  const httpStatus = optionalNumber(value.httpStatus);
  const operationPhase = optionalString(value.operationPhase);
  const providerStatus = optionalNumber(value.providerStatus);
  const providerRequestId = optionalString(value.providerRequestId);
  const providerCode = optionalString(value.providerCode);
  const connectUrl = optionalString(value.connectUrl);
  const diagnostic: ExternalMcpDiagnostic = {
    ...(referenceId ? { referenceId } : {}),
    // Keep unknown future phases/categories as safe strings so an older
    // dashboard can still show the reference and fall back to wire evidence.
    ...(phase ? { phase } : {}),
    ...(category ? { category } : {}),
    ...(code ? { code } : {}),
    ...(typeof value.retryable === "boolean" ? { retryable: value.retryable } : {}),
    ...(actionOwner ? { actionOwner } : {}),
    ...(operatorAction ? { operatorAction } : {}),
    ...(message ? { message } : {}),
    ...(highestPassed ? { highestPassed } : {}),
    ...(httpStatus !== undefined ? { httpStatus } : {}),
    ...(operationPhase ? { operationPhase } : {}),
    ...(providerStatus !== undefined ? { providerStatus } : {}),
    ...(providerRequestId ? { providerRequestId } : {}),
    ...(providerCode ? { providerCode } : {}),
    ...(connectUrl ? { connectUrl } : {}),
  };

  return Object.keys(diagnostic).length > 0 ? diagnostic : null;
}

function providerRequestIdFromInspection(inspection: InspectionEvidence | null): string | undefined {
  const requestIdHeaders = new Set([
    "x-ms-request-id",
    "x-ms-correlation-request-id",
    "x-servicenow-request-id",
    "x-correlation-id",
    "x-transaction-id",
    "request-id",
    "x-request-id",
  ]);
  return inspection?.response?.headers?.find((header) => (
    !header.redacted
    && requestIdHeaders.has(header.name.toLowerCase())
    && header.value.trim().length > 0
  ))?.value;
}

function unknownOutcomeGuidance(mayHaveSideEffects: boolean): string {
  return mayHaveSideEffects
    ? "不要立即重试。此工具可能已经修改外部数据，请先到服务方确认实际结果。"
    : "首次调用仍可能完成，请先检查服务方的近期记录再重试。";
}

function lastBoundaryFromDiagnostic(diagnostic: ExternalMcpDiagnostic | null): string | undefined {
  if (diagnostic?.highestPassed === "operation_ready") return "FoxWork 已开始执行远程工具";
  if (diagnostic?.highestPassed === "catalog_ready") return "FoxWork 已读取远程 MCP 工具目录";
  if (diagnostic?.highestPassed === "protocol_ready") return "FoxWork 已建立远程 MCP 会话";
  if (diagnostic?.highestPassed === "authorized") return "远程 MCP 已接受连接凭据";
  if (diagnostic?.highestPassed === "reachable") return "FoxWork 已连接远程 MCP 地址";
  if (diagnostic?.highestPassed === "configured") return "FoxWork 已读取 MCP 连接配置";
  return undefined;
}

function chineseDiagnosticText(value: string | undefined, fallback: string): string {
  return value && /[\u3400-\u9fff]/u.test(value) ? value : fallback;
}

function diagnosticDetails(diagnostic: ExternalMcpDiagnostic | null, inspection: InspectionEvidence | null) {
  const providerRequestId = diagnostic?.providerRequestId ?? providerRequestIdFromInspection(inspection);
  return {
    ...(diagnostic?.referenceId ? { diagnosticReference: diagnostic.referenceId } : {}),
    ...(providerRequestId ? { providerRequestId } : {}),
    ...(diagnostic?.code || diagnostic?.category
      ? { diagnosticCode: diagnostic.code ?? diagnostic.category }
      : {}),
  };
}

export function attributeExternalMcpToolFailure(input: {
  diagnostic: ExternalMcpDiagnostic | null;
  inspection: InspectionEvidence | null;
  browserTimeout: BrowserTimeoutEvidence | null;
  mayHaveSideEffects: boolean;
}): ExternalMcpFailureAttribution {
  const { browserTimeout, diagnostic, inspection, mayHaveSideEffects } = input;
  const details = diagnosticDetails(diagnostic, inspection);

  if (browserTimeout) {
    const seconds = browserTimeout.timeoutMs / 1000;
    const duration = Number.isInteger(seconds) ? `${seconds}` : seconds.toFixed(1);
    return {
      summary: `FoxWork 等待 ${duration} 秒后停止，本次操作结果尚未确认。`,
      lastConfirmedBoundary: "FoxWork 管理后台已发出请求",
      likelySource: "超时后的具体原因尚不明确",
      confidence: "Inferred",
      retryGuidance: unknownOutcomeGuidance(mayHaveSideEffects),
      outcome: "unknown",
      ...details,
    };
  }

  const blockedBeforeSend = diagnostic?.category === "security_blocked"
    || diagnostic?.code === "MCP_URL_BLOCKED"
    || diagnostic?.code === "MCP_FETCH_FORBIDDEN_PORT";
  if (blockedBeforeSend) {
    return {
      summary: "FoxWork 在请求发出前将其拦截。",
      lastConfirmedBoundary: "FoxWork 已完成外发安全检查",
      likelySource: "FoxWork 安全策略",
      confidence: "Confirmed",
      retryGuidance: chineseDiagnosticText(
        diagnostic?.operatorAction,
        "请先修正 FoxWork 安全策略或连接配置，再重新运行工具。",
      ),
      outcome: "failed",
      ...details,
    };
  }

  const responseStatus = inspection?.response?.status ?? diagnostic?.httpStatus;
  if (responseStatus !== undefined && (responseStatus < 200 || responseStatus >= 300)) {
    const retryableStatus = responseStatus === 408 || responseStatus === 429 || responseStatus === 502
      || responseStatus === 503 || responseStatus === 504;
    return {
      summary: `远程 MCP 返回 HTTP ${responseStatus}。`,
      lastConfirmedBoundary: `远程 MCP 已返回 HTTP ${responseStatus}`,
      likelySource: "远程 MCP",
      confidence: "Confirmed",
      retryGuidance: mayHaveSideEffects && (responseStatus === 408 || responseStatus === 504)
        ? "重试前请先到远程 MCP 或服务方确认操作是否已经完成。"
        : chineseDiagnosticText(
          diagnostic?.operatorAction,
          diagnostic?.retryable || retryableStatus
            ? "确认操作可以安全重复后，请稍候再试。"
            : "请检查远程 MCP 的响应和连接配置后再试。",
        ),
      outcome: "failed",
      ...details,
    };
  }

  const providerFailure = diagnostic?.phase?.startsWith("PROVIDER_")
    || diagnostic?.providerStatus !== undefined
    || diagnostic?.providerCode !== undefined;
  if (diagnostic?.code === "MCP_PROVIDER_AUTH_REQUIRED") {
    return {
      summary: "远程 MCP 已响应，但还需要登录下游服务账号。",
      lastConfirmedBoundary: responseStatus !== undefined
        ? `远程 MCP 返回 HTTP ${responseStatus}，并要求完成账号授权`
        : "远程 MCP 已返回账号授权要求",
      likelySource: "下游服务账号尚未授权",
      confidence: "Confirmed",
      retryGuidance: chineseDiagnosticText(
        diagnostic.operatorAction,
        "请先连接对应的服务账号，再重新运行工具。",
      ),
      outcome: "failed",
      ...details,
    };
  }
  if (providerFailure) {
    return {
      summary: "远程 MCP 已响应，但下游服务拒绝了本次操作。",
      lastConfirmedBoundary: responseStatus !== undefined
        ? `远程 MCP 返回 HTTP ${responseStatus} 和工具错误`
        : "远程 MCP 已返回工具错误",
      likelySource: "下游服务",
      confidence: "Confirmed",
      retryGuidance: chineseDiagnosticText(
        diagnostic?.operatorAction,
        diagnostic?.retryable
          ? "请确认服务方状态正常后稍候再试。"
          : "请先处理服务方返回的错误，再重新运行工具。",
      ),
      outcome: "failed",
      ...details,
    };
  }

  const deadlineAfterSend = Boolean(inspection?.request)
    && !inspection?.response
    && (diagnostic?.code === "MCP_LIFECYCLE_DEADLINE" || diagnostic?.code === "MCP_REQUEST_TIMEOUT");
  if (deadlineAfterSend) {
    return {
      summary: "FoxWork 已发出请求，但远程 MCP 未在规定时间内响应。",
      lastConfirmedBoundary: "FoxWork 已开始发送工具调用",
      likelySource: "网络或远程 MCP",
      confidence: "Inferred",
      retryGuidance: unknownOutcomeGuidance(mayHaveSideEffects),
      outcome: "unknown",
      ...details,
    };
  }

  if (inspection?.request && !inspection.response) {
    return {
      summary: "FoxWork 已发出请求，但没有捕获到 HTTP 响应，暂时无法确认具体故障方。",
      lastConfirmedBoundary: "FoxWork 已开始发送工具调用",
      likelySource: "请求发出后的具体原因尚不明确",
      confidence: "Inferred",
      retryGuidance: unknownOutcomeGuidance(mayHaveSideEffects),
      outcome: "unknown",
      ...details,
    };
  }

  if (inspection?.response) {
    return {
      summary: chineseDiagnosticText(
        inspection.diagnosis?.summary,
        "远程 MCP 已响应，但工具没有成功完成。",
      ),
      lastConfirmedBoundary: `远程 MCP 已返回 HTTP ${inspection.response.status}`,
      likelySource: "MCP 工具结果",
      confidence: "Inferred",
      retryGuidance: chineseDiagnosticText(
        diagnostic?.operatorAction,
        "请先检查 MCP 工具结果和诊断编号，再重新运行。",
      ),
      outcome: "failed",
      ...details,
    };
  }

  const networkSetup = diagnostic?.phase?.startsWith("NETWORK_") || inspection?.diagnosis?.layer === "network";
  return {
    summary: chineseDiagnosticText(
      inspection?.diagnosis?.summary ?? diagnostic?.message,
      "FoxWork 在收到工具结果前遇到错误。",
    ),
    lastConfirmedBoundary: lastBoundaryFromDiagnostic(diagnostic)
      ?? (diagnostic ? "FoxWork 已返回结构化诊断信息" : "FoxWork 管理后台已发出请求"),
    likelySource: networkSetup ? "连接链路或远程 MCP" : "FoxWork 或 MCP 配置",
    confidence: "Inferred",
    retryGuidance: chineseDiagnosticText(
      diagnostic?.operatorAction,
      "请根据诊断编号检查 FoxWork 和 MCP 连接状态，再重新运行。",
    ),
    outcome: "failed",
    ...details,
  };
}
