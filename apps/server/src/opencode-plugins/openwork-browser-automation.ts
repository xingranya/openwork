import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";

import {
  buildAccessibilitySnapshot,
  formatBrowserEvaluationResult,
  serializeBrowserEvaluationValue,
  type AccessibilityNode,
  type BrowserAccessibilitySnapshot,
} from "./openwork-browser-automation-lib.js";

const TOOL_VERSION = "foxwork-browser-automation@1.0.0";

type CdpTarget = {
  id: string;
  title: string;
  type: string;
  url: string;
  webSocketDebuggerUrl: string;
};

type CdpResponse = {
  id?: number;
  result?: unknown;
  error?: { message?: string };
};

type RemoteObject = {
  objectId?: string;
  value?: unknown;
  unserializableValue?: string;
};

type RuntimeResult = {
  result?: RemoteObject;
  exceptionDetails?: { text?: string; exception?: { description?: string } };
};

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCdpTarget(value: unknown): value is CdpTarget {
  return isRecord(value)
    && typeof value.id === "string"
    && typeof value.type === "string"
    && typeof value.title === "string"
    && typeof value.url === "string"
    && typeof value.webSocketDebuggerUrl === "string";
}

function isAccessibilityNode(value: unknown): value is AccessibilityNode {
  return isRecord(value) && typeof value.nodeId === "string";
}

class CdpClient {
  private socket: WebSocket | null = null;
  private nextId = 0;
  private readonly pending = new Map<number, PendingRequest>();
  private readonly handlers = new Map<string, Array<(params: unknown) => void>>();

  constructor(private readonly endpoint: string) {}

  async connect(): Promise<void> {
    if (this.socket?.readyState === WebSocket.OPEN) return;
    const socket = new WebSocket(this.endpoint);
    this.socket = socket;
    await new Promise<void>((resolve, reject) => {
      const onOpen = () => {
        socket.removeEventListener("error", onError);
        resolve();
      };
      const onError = () => {
        socket.removeEventListener("open", onOpen);
        reject(new Error("无法连接浏览器调试端口。"));
      };
      socket.addEventListener("open", onOpen, { once: true });
      socket.addEventListener("error", onError, { once: true });
    });
    socket.addEventListener("message", (event) => this.handleMessage(event.data));
    socket.addEventListener("close", () => this.failPending("浏览器调试连接已关闭。"));
  }

  private handleMessage(data: unknown): void {
    let message: CdpResponse & { method?: string; params?: unknown };
    try {
      message = JSON.parse(typeof data === "string" ? data : String(data));
    } catch {
      return;
    }
    if (typeof message.id === "number") {
      const request = this.pending.get(message.id);
      if (!request) return;
      this.pending.delete(message.id);
      clearTimeout(request.timer);
      if (message.error) request.reject(new Error(message.error.message || "浏览器调试命令失败。"));
      else request.resolve(message.result ?? {});
      return;
    }
    if (message.method) {
      for (const handler of this.handlers.get(message.method) ?? []) handler(message.params);
    }
  }

  private failPending(message: string): void {
    for (const request of this.pending.values()) {
      clearTimeout(request.timer);
      request.reject(new Error(message));
    }
    this.pending.clear();
    this.socket = null;
  }

  async send<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    const socket = this.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN) throw new Error("浏览器调试连接尚未建立。");
    const id = this.nextId + 1;
    this.nextId = id;
    return await new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`浏览器调试命令超时：${method}`));
      }, 30_000);
      this.pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
        timer,
      });
      socket.send(JSON.stringify({ id, method, params }));
    });
  }

  on(event: string, handler: (params: unknown) => void): void {
    const handlers = this.handlers.get(event) ?? [];
    handlers.push(handler);
    this.handlers.set(event, handlers);
  }

  close(): void {
    this.socket?.close();
    this.failPending("浏览器调试连接已关闭。");
  }
}

async function listTargets(browserUrl: string): Promise<CdpTarget[]> {
  const endpoint = browserUrl.replace(/\/$/, "");
  const response = await fetch(`${endpoint}/json/list`);
  if (!response.ok) throw new Error(`读取浏览器页面列表失败（HTTP ${response.status}）。`);
  const payload: unknown = await response.json();
  const targets = Array.isArray(payload) ? payload.filter(isCdpTarget) : [];
  const parsedEndpoint = new URL(endpoint);
  if (["localhost", "127.0.0.1", "0.0.0.0"].includes(parsedEndpoint.hostname)) return targets;
  const protocol = parsedEndpoint.protocol === "https:" ? "wss:" : "ws:";
  return targets.map((target) => {
    const path = new URL(target.webSocketDebuggerUrl).pathname;
    return { ...target, webSocketDebuggerUrl: `${protocol}//${parsedEndpoint.host}${path}` };
  });
}

async function getClient(browserUrl: string, targetId?: string): Promise<{ client: CdpClient; target: CdpTarget }> {
  const targets = await listTargets(browserUrl);
  const target = targetId
    ? targets.find((candidate) => candidate.id === targetId)
    : targets.find((candidate) => candidate.type === "page");
  if (!target) throw new Error(targetId ? `没有找到浏览器页面 ${targetId}。` : "没有找到可操作的浏览器页面。");
  const client = new CdpClient(target.webSocketDebuggerUrl);
  await client.connect();
  return { client, target };
}

function cacheKey(browserUrl: string, targetId?: string): string {
  return `${browserUrl}::${targetId ?? "default"}`;
}

function runtimeError(result: RuntimeResult): string | null {
  if (!result.exceptionDetails) return null;
  return result.exceptionDetails.exception?.description
    ?? result.exceptionDetails.text
    ?? "页面脚本执行失败。";
}

const endpointArgs = {
  browser_url: z.string().min(1).describe("浏览器 CDP 地址"),
  target_id: z.string().min(1).optional().describe("浏览器页面编号"),
};

const snapshotCache = new Map<string, BrowserAccessibilitySnapshot>();

export const OpenWorkBrowserAutomation = async () => ({
  tool: {
    browser_version: {
      description: "查看 FoxWork 内置浏览器工具版本。",
      args: {},
      async execute() {
        return TOOL_VERSION;
      },
    },
    browser_list: {
      description: "列出可操作的浏览器页面。",
      args: { browser_url: endpointArgs.browser_url },
      async execute(rawArgs: unknown) {
        const args = z.object({ browser_url: endpointArgs.browser_url }).parse(rawArgs);
        const pages = (await listTargets(args.browser_url)).filter((target) => target.type === "page");
        if (pages.length === 0) return "没有找到可操作的浏览器页面。";
        return pages.map((target) => `[${target.id}] ${target.title}\n  ${target.url}`).join("\n\n");
      },
    },
    browser_navigate: {
      description: "打开指定网页并返回页面标题。",
      args: {
        ...endpointArgs,
        url: z.string().min(1).describe("要打开的网页地址"),
      },
      async execute(rawArgs: unknown) {
        const args = z.object({ ...endpointArgs, url: z.string().min(1) }).parse(rawArgs);
        const { client } = await getClient(args.browser_url, args.target_id);
        try {
          await client.send("Page.enable");
          await client.send("Page.navigate", { url: args.url });
          await new Promise<void>((resolve) => {
            const timer = setTimeout(resolve, 10_000);
            client.on("Page.loadEventFired", () => {
              clearTimeout(timer);
              resolve();
            });
          });
          const result = await client.send<RuntimeResult>("Runtime.evaluate", {
            expression: "document.title",
            returnByValue: true,
          });
          return `已打开：${args.url}\n标题：${formatBrowserEvaluationResult(result.result?.value)}`;
        } finally {
          client.close();
        }
      },
    },
    browser_snapshot: {
      description: "读取带编号的页面结构，编号可用于点击和填写。",
      args: endpointArgs,
      async execute(rawArgs: unknown) {
        const args = z.object(endpointArgs).parse(rawArgs);
        const { client } = await getClient(args.browser_url, args.target_id);
        try {
          await client.send("Accessibility.enable");
          const result = await client.send<{ nodes?: unknown[] }>("Accessibility.getFullAXTree");
          const nodes = Array.isArray(result.nodes) ? result.nodes.filter(isAccessibilityNode) : [];
          const snapshot = buildAccessibilitySnapshot(nodes);
          snapshotCache.set(cacheKey(args.browser_url, args.target_id), snapshot);
          if (snapshot.nodes.length > 0) return snapshot.text;
          const fallback = await client.send<RuntimeResult>("Runtime.evaluate", {
            expression: "document.body?.innerText?.substring(0, 3000) ?? '（页面为空）'",
            returnByValue: true,
          });
          return `页面文字：\n${formatBrowserEvaluationResult(fallback.result?.value)}`;
        } finally {
          client.close();
        }
      },
    },
    browser_click: {
      description: "点击页面结构编号对应的元素，请先读取页面结构。",
      args: {
        ...endpointArgs,
        uid: z.number().int().positive().describe("页面结构编号"),
      },
      async execute(rawArgs: unknown) {
        const args = z.object({ ...endpointArgs, uid: z.number().int().positive() }).parse(rawArgs);
        const snapshot = snapshotCache.get(cacheKey(args.browser_url, args.target_id));
        if (!snapshot) return "尚未读取页面结构，请先调用 browser_snapshot。";
        const node = snapshot.byUid.get(args.uid);
        if (!node) return `页面结构中没有编号 ${args.uid}。`;
        if (node.backendNodeId <= 0) return `编号 ${args.uid} 不能映射到可点击元素。`;
        const { client } = await getClient(args.browser_url, args.target_id);
        try {
          const box = await client.send<{ model?: { content?: number[] } }>("DOM.getBoxModel", { backendNodeId: node.backendNodeId })
            .catch(() => ({ model: undefined }));
          const content = box.model?.content;
          if (content && content.length >= 8) {
            const x = (content[0] + content[2] + content[4] + content[6]) / 4;
            const y = (content[1] + content[3] + content[5] + content[7]) / 4;
            await client.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
            await client.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
            return `已点击 [${args.uid}] ${JSON.stringify(node.name)}。`;
          }
          const resolved = await client.send<{ object?: { objectId?: string } }>("DOM.resolveNode", { backendNodeId: node.backendNodeId });
          if (!resolved.object?.objectId) return `无法定位编号 ${args.uid}。`;
          await client.send("Runtime.callFunctionOn", {
            objectId: resolved.object.objectId,
            functionDeclaration: "function() { this.scrollIntoView({ block: 'center' }); this.click(); }",
          });
          return `已点击 [${args.uid}] ${JSON.stringify(node.name)}。`;
        } finally {
          client.close();
        }
      },
    },
    browser_fill: {
      description: "清空并填写页面结构编号对应的输入框。",
      args: {
        ...endpointArgs,
        uid: z.number().int().positive().describe("页面结构编号"),
        value: z.string().describe("要填写的内容"),
      },
      async execute(rawArgs: unknown) {
        const args = z.object({ ...endpointArgs, uid: z.number().int().positive(), value: z.string() }).parse(rawArgs);
        const snapshot = snapshotCache.get(cacheKey(args.browser_url, args.target_id));
        if (!snapshot) return "尚未读取页面结构，请先调用 browser_snapshot。";
        const node = snapshot.byUid.get(args.uid);
        if (!node) return `页面结构中没有编号 ${args.uid}。`;
        if (node.backendNodeId <= 0) return `编号 ${args.uid} 不能映射到输入框。`;
        const { client } = await getClient(args.browser_url, args.target_id);
        try {
          const resolved = await client.send<{ object?: { objectId?: string } }>("DOM.resolveNode", { backendNodeId: node.backendNodeId });
          const objectId = resolved.object?.objectId;
          if (!objectId) return `无法定位编号 ${args.uid}。`;
          await client.send("Runtime.callFunctionOn", {
            objectId,
            functionDeclaration: "function() { this.focus(); if (typeof this.select === 'function') this.select(); this.value = ''; this.dispatchEvent(new Event('input', { bubbles: true })); }",
          });
          await client.send("Input.insertText", { text: args.value });
          await client.send("Runtime.callFunctionOn", {
            objectId,
            functionDeclaration: "function() { this.dispatchEvent(new Event('change', { bubbles: true })); }",
          });
          return `已填写 [${args.uid}] ${JSON.stringify(node.name)}。`;
        } finally {
          client.close();
        }
      },
    },
    browser_eval: {
      description: "在页面中执行 JavaScript 表达式，并返回可读结果。",
      args: {
        ...endpointArgs,
        expression: z.string().min(1).describe("要执行的 JavaScript 表达式"),
      },
      async execute(rawArgs: unknown) {
        const args = z.object({ ...endpointArgs, expression: z.string().min(1) }).parse(rawArgs);
        const { client } = await getClient(args.browser_url, args.target_id);
        try {
          const result = await client.send<RuntimeResult>("Runtime.evaluate", {
            expression: args.expression,
            returnByValue: false,
            awaitPromise: true,
          });
          const error = runtimeError(result);
          if (error) return `执行失败：${error}`;
          const remote = result.result;
          if (!remote?.objectId) return formatBrowserEvaluationResult(remote?.value ?? remote?.unserializableValue);
          try {
            const serialized = await client.send<RuntimeResult>("Runtime.callFunctionOn", {
              objectId: remote.objectId,
              functionDeclaration: serializeBrowserEvaluationValue.toString(),
              returnByValue: true,
              awaitPromise: true,
            });
            const serializationError = runtimeError(serialized);
            if (serializationError) return `读取结果失败：${serializationError}`;
            return formatBrowserEvaluationResult(serialized.result?.value);
          } finally {
            await client.send("Runtime.releaseObject", { objectId: remote.objectId }).catch(() => undefined);
          }
        } finally {
          client.close();
        }
      },
    },
    browser_screenshot: {
      description: "截取当前网页并返回 PNG 文件路径。",
      args: endpointArgs,
      async execute(rawArgs: unknown) {
        const args = z.object(endpointArgs).parse(rawArgs);
        const { client } = await getClient(args.browser_url, args.target_id);
        try {
          const result = await client.send<{ data?: string }>("Page.captureScreenshot", { format: "png" });
          if (!result.data) return "网页截图失败。";
          const path = join(tmpdir(), `foxwork-browser-${Date.now()}.png`);
          await writeFile(path, Buffer.from(result.data, "base64"));
          return `截图已保存：${path}`;
        } finally {
          client.close();
        }
      },
    },
  },
});
