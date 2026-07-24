import { afterEach, describe, expect, test } from "bun:test";
import {
  DenRequestCanceledError,
  DenRequestTimeoutError,
  requestJson,
} from "../app/(den)/_lib/den-flow";
import {
  attributeExternalMcpToolFailure,
  parseExternalMcpDiagnostic,
} from "../app/(den)/dashboard/_components/mcp-tool-error-attribution";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function abortingFetch(_input: string | URL | Request, init?: RequestInit): Promise<Response> {
  return new Promise<Response>((_resolve, reject) => {
    const signal = init?.signal;
    const rejectAbort = () => reject(new DOMException("The operation was aborted.", "AbortError"));
    if (!signal) {
      reject(new Error("Expected an abort signal."));
      return;
    }
    if (signal.aborted) {
      rejectAbort();
      return;
    }
    signal.addEventListener("abort", rejectAbort, { once: true });
  });
}

describe("browser-to-Den timeout", () => {
  test("throws a typed unknown-outcome error for the dashboard-created deadline", async () => {
    globalThis.fetch = abortingFetch;
    const error = await requestJson("/v1/mcp-connections/test/tools/call", {}, 5).catch((failure) => failure);

    expect(error).toBeInstanceOf(DenRequestTimeoutError);
    if (!(error instanceof DenRequestTimeoutError)) throw new Error("Expected DenRequestTimeoutError");
    expect(error.timeoutMs).toBe(5);
    expect(error.outcome).toBe("unknown");
    expect(error.message).toBe(
      "等待 5 毫秒后仍未收到结果。操作可能已经执行，请刷新后确认。",
    );
    expect(new DenRequestTimeoutError(160_000).message).toBe(
      "等待 160 秒后仍未收到结果。操作可能已经执行，请刷新后确认。",
    );
  });

  test("distinguishes a caller cancellation without exposing AbortError", async () => {
    globalThis.fetch = abortingFetch;
    const controller = new AbortController();
    controller.abort();
    const error = await requestJson(
      "/v1/mcp-connections/test/tools/call",
      { signal: controller.signal },
      5,
    ).catch((failure) => failure);

    expect(error).not.toBeInstanceOf(DenRequestTimeoutError);
    expect(error).toBeInstanceOf(DenRequestCanceledError);
    if (!(error instanceof DenRequestCanceledError)) throw new Error("Expected DenRequestCanceledError");
    expect(error.name).toBe("DenRequestCanceledError");
    expect(error.outcome).toBe("unknown");
  });
});

describe("MCP failure attribution", () => {
  test("marks a Den lifecycle deadline after tools/call as inferred and unknown", () => {
    const attribution = attributeExternalMcpToolFailure({
      diagnostic: {
        referenceId: "req_deadline",
        phase: "MCP_TOOL_EXECUTION",
        category: "lifecycle_deadline",
        code: "MCP_LIFECYCLE_DEADLINE",
        retryable: true,
        actionOwner: "provider_admin",
      },
      inspection: { request: {} },
      browserTimeout: null,
      mayHaveSideEffects: false,
    });

    expect(attribution).toMatchObject({
      summary: "FoxWork 已发出请求，但远程 MCP 未在规定时间内响应。",
      lastConfirmedBoundary: "FoxWork 已开始发送工具调用",
      likelySource: "网络或远程 MCP",
      confidence: "Inferred",
      outcome: "unknown",
      diagnosticReference: "req_deadline",
      diagnosticCode: "MCP_LIFECYCLE_DEADLINE",
    });
  });

  test.each([408, 504])("attributes remote MCP HTTP %d responses as confirmed", (status) => {
    const attribution = attributeExternalMcpToolFailure({
      diagnostic: { referenceId: `req_${status}`, retryable: true, httpStatus: status },
      inspection: { request: {}, response: { status, headers: [] } },
      browserTimeout: null,
      mayHaveSideEffects: false,
    });

    expect(attribution).toMatchObject({
      summary: `远程 MCP 返回 HTTP ${status}。`,
      lastConfirmedBoundary: `远程 MCP 已返回 HTTP ${status}`,
      likelySource: "远程 MCP",
      confidence: "Confirmed",
      outcome: "failed",
    });
  });

  test("attributes an MCP/provider error returned through HTTP 200", () => {
    const attribution = attributeExternalMcpToolFailure({
      diagnostic: {
        referenceId: "req_provider",
        phase: "PROVIDER_AUTHORIZATION",
        category: "provider_policy_denied",
        code: "MCP_PROVIDER_HTTP_403",
        retryable: false,
        actionOwner: "provider_admin",
        providerStatus: 403,
        providerRequestId: "provider-request-123",
      },
      inspection: { request: {}, response: { status: 200, headers: [] } },
      browserTimeout: null,
      mayHaveSideEffects: false,
    });

    expect(attribution).toMatchObject({
      summary: "远程 MCP 已响应，但下游服务拒绝了本次操作。",
      lastConfirmedBoundary: "远程 MCP 返回 HTTP 200 和工具错误",
      likelySource: "下游服务",
      confidence: "Confirmed",
      providerRequestId: "provider-request-123",
    });
  });

  test("attributes downstream provider authorization as a confirmed provider response", () => {
    const attribution = attributeExternalMcpToolFailure({
      diagnostic: {
        referenceId: "req_provider_auth",
        phase: "PROVIDER_AUTHORIZATION",
        category: "provider_authorization_required",
        code: "MCP_PROVIDER_AUTH_REQUIRED",
        retryable: false,
        actionOwner: "member",
        operatorAction: "Connect your account for this provider using its sign-in link, then retry this capability.",
      },
      inspection: { request: {} },
      browserTimeout: null,
      mayHaveSideEffects: false,
    });

    expect(attribution).toMatchObject({
      summary: "远程 MCP 已响应，但还需要登录下游服务账号。",
      lastConfirmedBoundary: "远程 MCP 已返回账号授权要求",
      likelySource: "下游服务账号尚未授权",
      confidence: "Confirmed",
      outcome: "failed",
      diagnosticReference: "req_provider_auth",
      diagnosticCode: "MCP_PROVIDER_AUTH_REQUIRED",
    });
  });

  test("attributes an OpenWork block before send as confirmed", () => {
    const attribution = attributeExternalMcpToolFailure({
      diagnostic: {
        referenceId: "req_blocked",
        phase: "CONFIGURATION",
        category: "security_blocked",
        code: "MCP_URL_BLOCKED",
        retryable: false,
        actionOwner: "organization_admin",
      },
      // 检查器在 SSRF 防护之前捕获请求，因此这条记录不能证明请求已经离开 Den。
      inspection: { request: {} },
      browserTimeout: null,
      mayHaveSideEffects: true,
    });

    expect(attribution).toMatchObject({
      summary: "FoxWork 在请求发出前将其拦截。",
      lastConfirmedBoundary: "FoxWork 已完成外发安全检查",
      likelySource: "FoxWork 安全策略",
      confidence: "Confirmed",
      outcome: "failed",
    });
  });

  test("warns against immediately retrying a destructive tool with unknown outcome", () => {
    const attribution = attributeExternalMcpToolFailure({
      diagnostic: null,
      inspection: null,
      browserTimeout: { timeoutMs: 160_000, outcome: "unknown" },
      mayHaveSideEffects: true,
    });

    expect(attribution.summary).toBe(
      "FoxWork 等待 160 秒后停止，本次操作结果尚未确认。",
    );
    expect(attribution.retryGuidance).toContain("不要立即重试");
    expect(attribution.retryGuidance).toContain("可能已经修改外部数据");
  });

  test("parses current diagnostics and falls back to wire evidence across deploy skew", () => {
    expect(parseExternalMcpDiagnostic({
      referenceId: "req_full",
      phase: "FUTURE_PROVIDER_PHASE",
      category: "provider_error",
      code: "MCP_PROVIDER_ERROR",
      retryable: false,
      actionOwner: "provider_admin",
      operatorAction: "Inspect provider logs.",
      message: "Safe provider failure.",
      highestPassed: "operation_ready",
      httpStatus: 200,
      operationPhase: "MCP_TOOL_EXECUTION",
      providerStatus: 403,
      providerRequestId: "provider-request-456",
      providerCode: "access_denied",
      connectUrl: "https://mcp-gateway.fixture.test/servers/salesforce/connect/start",
    })).toEqual({
      referenceId: "req_full",
      phase: "FUTURE_PROVIDER_PHASE",
      category: "provider_error",
      code: "MCP_PROVIDER_ERROR",
      retryable: false,
      actionOwner: "provider_admin",
      operatorAction: "Inspect provider logs.",
      message: "Safe provider failure.",
      highestPassed: "operation_ready",
      httpStatus: 200,
      operationPhase: "MCP_TOOL_EXECUTION",
      providerStatus: 403,
      providerRequestId: "provider-request-456",
      providerCode: "access_denied",
      connectUrl: "https://mcp-gateway.fixture.test/servers/salesforce/connect/start",
    });

    const attribution = attributeExternalMcpToolFailure({
      diagnostic: null,
      inspection: {
        request: {},
        response: {
          status: 504,
          headers: [{ name: "x-request-id", value: "wire-request-789", redacted: false }],
        },
        diagnosis: { layer: "remote_http", summary: "Older OpenWork failure shape." },
      },
      browserTimeout: null,
      mayHaveSideEffects: false,
    });
    expect(attribution).toMatchObject({
      summary: "远程 MCP 返回 HTTP 504。",
      confidence: "Confirmed",
      providerRequestId: "wire-request-789",
    });
  });
});
