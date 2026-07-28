import { describe, expect, test } from "bun:test";
import { spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { createOpencodeClient } from "@opencode-ai/sdk/v2/client";

import type { ComposerAttachment } from "../src/app/types";
import { composerAttachmentsToWorkspaceFileParts } from "../src/react-app/domains/session/sync/attachment-file-part";

const repoRoot = resolve(import.meta.dir, "../../..");
const sidecarDirectory = join(repoRoot, "apps/desktop/resources/sidecars");

function findSidecar() {
  const architecture = process.arch === "arm64" ? "aarch64" : "x86_64";
  const names = process.platform === "darwin"
    ? [`opencode-${architecture}-apple-darwin`, "opencode"]
    : process.platform === "linux"
      ? [`opencode-${architecture}-unknown-linux-gnu`, `opencode-${architecture}-unknown-linux-musl`, "opencode"]
      : [];
  return names.map((name) => join(sidecarDirectory, name)).find(existsSync) ?? null;
}

const sidecar = findSidecar();
const describeWithSidecar = sidecar ? describe : describe.skip;

const PNG_BYTES = new Uint8Array(readFileSync(join(repoRoot, "apps/desktop/resources/icons/dev/32x32.png")));
const JPEG_BYTES = new Uint8Array(readFileSync(join(repoRoot, "ee/apps/landing/public/enterprise-showcase-bg.jpg")));

type CapturedRequest = {
  path: string;
  body: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorSummary(error: unknown) {
  if (error instanceof Error) {
    const record = isRecord(error) ? error : null;
    const response = record?.response instanceof Response ? record.response : null;
    return {
      name: error.name,
      message: error.message,
      cause: error.cause,
      data: record?.data,
      status: response?.status,
    };
  }
  return String(error);
}

function attachment(file: File, id: string): ComposerAttachment {
  return {
    id,
    name: file.name,
    mimeType: file.type,
    size: file.size,
    kind: "image",
    file,
  };
}

function base64(bytes: Uint8Array) {
  return Buffer.from(bytes).toString("base64");
}

function sha256(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex");
}

function collectOpenAiImageUrls(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(collectOpenAiImageUrls);
  if (!isRecord(value)) return [];

  const own = value.type === "image_url"
    && isRecord(value.image_url)
    && typeof value.image_url.url === "string"
      ? [value.image_url.url]
      : [];
  return [...own, ...Object.values(value).flatMap(collectOpenAiImageUrls)];
}

type AnthropicImageSource = {
  type: string;
  mediaType: string;
  data: string;
};

function collectAnthropicImageSources(value: unknown): AnthropicImageSource[] {
  if (Array.isArray(value)) return value.flatMap(collectAnthropicImageSources);
  if (!isRecord(value)) return [];

  const source = isRecord(value.source) ? value.source : null;
  const own = value.type === "image"
    && source?.type === "base64"
    && typeof source.media_type === "string"
    && typeof source.data === "string"
      ? [{ type: source.type, mediaType: source.media_type, data: source.data }]
      : [];
  return [...own, ...Object.values(value).flatMap(collectAnthropicImageSources)];
}

async function freePort() {
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response() });
  const port = server.port;
  server.stop(true);
  if (!port) throw new Error("无法分配本机测试端口");
  return port;
}

async function waitFor<T>(read: () => T | null | Promise<T | null>, timeoutMs: number, label: string): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await read();
    if (value !== null) return value;
    await Bun.sleep(100);
  }
  throw new Error(`等待${label}超时`);
}

async function waitForHealth(baseUrl: string, directory: string) {
  const client = createOpencodeClient({
    baseUrl,
    directory,
    responseStyle: "data",
    throwOnError: true,
  });
  await waitFor(async () => {
    try {
      const health = await client.global.health();
      return health.healthy ? true : null;
    } catch {
      return null;
    }
  }, 30_000, "OpenCode Sidecar 启动");
  return client;
}

async function stopProcess(process: ChildProcess) {
  if (process.exitCode !== null || process.signalCode !== null) return;
  process.kill("SIGTERM");
  await Promise.race([
    new Promise<void>((resolveExit) => process.once("exit", () => resolveExit())),
    Bun.sleep(1_000),
  ]);
  if (process.exitCode === null && process.signalCode === null) process.kill("SIGKILL");
}

describeWithSidecar("图片附件最终供应商请求", () => {
  test("真实 Sidecar 会把 PNG 和 JPEG 字节转换为 OpenAI 与 Anthropic 图片部件", async () => {
    const requests: CapturedRequest[] = [];
    const provider = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(request) {
        const url = new URL(request.url);
        if (request.method === "POST") {
          const text = await request.text();
          let body: unknown = null;
          try {
            body = JSON.parse(text);
          } catch {
            body = text;
          }
          requests.push({ path: url.pathname, body });
          return Response.json({ error: { message: "测试请求已捕获" } }, { status: 400 });
        }
        return Response.json({ ok: true });
      },
    });

    const enginePort = await freePort();
    const workspace = mkdtempSync(join(tmpdir(), "foxwork-vision-wire-"));
    const runtimeData = mkdtempSync(join(tmpdir(), "foxwork-vision-runtime-"));
    const providerBaseUrl = `http://127.0.0.1:${provider.port}`;
    const configPath = join(workspace, "opencode.json");
    writeFileSync(configPath, JSON.stringify({
      $schema: "https://opencode.ai/config.json",
      provider: {
        "vision-openai": {
          npm: "@ai-sdk/openai-compatible",
          name: "OpenAI 图片协议测试",
          options: { baseURL: `${providerBaseUrl}/openai/v1`, apiKey: "sk-test-openai" },
          models: {
            "vision-model": {
              name: "OpenAI 图片协议测试模型",
              attachment: true,
              modalities: { input: ["text", "image"], output: ["text"] },
              limit: { context: 8_192, output: 1_024 },
              variants: {
                high: { reasoningEffort: "high" },
              },
            },
          },
        },
        "vision-anthropic": {
          npm: "@ai-sdk/anthropic",
          name: "Anthropic 图片协议测试",
          options: { baseURL: `${providerBaseUrl}/anthropic/v1`, apiKey: "sk-test-anthropic" },
          models: {
            "vision-model": {
              name: "Anthropic 图片协议测试模型",
              attachment: true,
              modalities: { input: ["text", "image"], output: ["text"] },
              limit: { context: 8_192, output: 1_024 },
              variants: {
                high: { thinking: { type: "enabled", budgetTokens: 16000 } },
              },
            },
          },
        },
      },
    }, null, 2));

    let stdout = "";
    let stderr = "";
    let diagnostics: unknown = null;
    const engine = spawn(sidecar!, ["serve", "--hostname", "127.0.0.1", "--port", String(enginePort)], {
      cwd: workspace,
      env: {
        ...process.env,
        XDG_DATA_HOME: join(runtimeData, "data"),
        XDG_CONFIG_HOME: join(runtimeData, "config"),
        XDG_STATE_HOME: join(runtimeData, "state"),
        XDG_CACHE_HOME: join(runtimeData, "cache"),
        OPENCODE_CONFIG: configPath,
        OPENCODE_DISABLE_AUTOUPDATE: "1",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    engine.stdout?.setEncoding("utf8");
    engine.stdout?.on("data", (chunk) => {
      stdout += String(chunk);
    });
    engine.stderr?.setEncoding("utf8");
    engine.stderr?.on("data", (chunk) => {
      stderr += String(chunk);
    });

    try {
      const client = await waitForHealth(`http://127.0.0.1:${enginePort}`, workspace);
      const providerList = await client.provider.list();
      diagnostics = {
        providers: providerList.all.filter((providerItem) => providerItem.id.startsWith("vision-")),
        connected: providerList.connected.filter((providerId) => providerId.startsWith("vision-")),
      };
      const imageAttachments = [
        attachment(new File([PNG_BYTES], "品牌正面图.png", { type: "image/png" }), "png"),
        attachment(new File([JPEG_BYTES], "门店照片.jpg", { type: "image/jpeg" }), "jpeg"),
      ];
      const uploads: Array<{ workspaceId: string; filename: string; sha256: string }> = [];
      const workspaceParts = async (workspaceId: string, workspaceRoot: string, sessionId: string) => {
        let sequence = 0;
        return await composerAttachmentsToWorkspaceFileParts({
          attachments: imageAttachments,
          endpoint: {
            workspaceId,
            client: {
              uploadInbox: async (id, file, options) => {
                const bytes = new Uint8Array(await file.arrayBuffer());
                uploads.push({ workspaceId: id, filename: file.name, sha256: sha256(bytes) });
                return { ok: true, path: options?.path ?? file.name, bytes: file.size };
              },
            },
          },
          sessionId,
          workspaceRoot,
          createId: () => `image-${sequence += 1}`,
        });
      };
      const localParts = await workspaceParts("local-workspace", workspace, "local-session");
      const remoteParts = await workspaceParts("remote-workspace", "/srv/foxwork/remote-user", "remote-session");

      expect(uploads).toEqual([
        { workspaceId: "local-workspace", filename: "品牌正面图.png", sha256: sha256(PNG_BYTES) },
        { workspaceId: "local-workspace", filename: "门店照片.jpg", sha256: sha256(JPEG_BYTES) },
        { workspaceId: "remote-workspace", filename: "品牌正面图.png", sha256: sha256(PNG_BYTES) },
        { workspaceId: "remote-workspace", filename: "门店照片.jpg", sha256: sha256(JPEG_BYTES) },
      ]);

      const openAiSession = await client.session.create({ title: "OpenAI 图片协议测试" });
      let openAiPromptError: unknown = null;
      try {
        await client.session.prompt({
          sessionID: openAiSession.id,
          model: { providerID: "vision-openai", modelID: "vision-model" },
          variant: "high",
          parts: [{ type: "text", text: "请比较两张图片。" }, ...localParts],
        });
      } catch (error) {
        openAiPromptError = errorSummary(error);
      }
      diagnostics = {
        ...(isRecord(diagnostics) ? diagnostics : {}),
        openAiPromptError,
        openAiMessages: await client.session.messages({ sessionID: openAiSession.id }),
        sessionStatus: await client.session.status(),
      };

      const openAiRequest = await waitFor(
        () => requests.find((item) => item.path.endsWith("/chat/completions")
          && collectOpenAiImageUrls(item.body).length >= 2) ?? null,
        20_000,
        "OpenAI 兼容图片请求",
      );
      expect(collectOpenAiImageUrls(openAiRequest.body)).toEqual(expect.arrayContaining([
        `data:image/png;base64,${base64(PNG_BYTES)}`,
        `data:image/jpeg;base64,${base64(JPEG_BYTES)}`,
      ]));
      expect(openAiRequest.body).toMatchObject({ reasoning_effort: "high" });

      const anthropicSession = await client.session.create({ title: "Anthropic 图片协议测试" });
      await client.session.prompt({
        sessionID: anthropicSession.id,
        model: { providerID: "vision-anthropic", modelID: "vision-model" },
        variant: "high",
        parts: [{ type: "text", text: "请比较两张图片。" }, ...remoteParts],
      }).catch(() => undefined);

      const anthropicRequest = await waitFor(
        () => requests.find((item) => item.path.endsWith("/messages")
          && collectAnthropicImageSources(item.body).length >= 2) ?? null,
        20_000,
        "Anthropic 图片请求",
      );
      expect(collectAnthropicImageSources(anthropicRequest.body)).toEqual(expect.arrayContaining([
        { type: "base64", mediaType: "image/png", data: base64(PNG_BYTES) },
        { type: "base64", mediaType: "image/jpeg", data: base64(JPEG_BYTES) },
      ]));
      expect(anthropicRequest.body).toMatchObject({
        thinking: { type: "enabled", budget_tokens: 16000 },
      });
    } catch (error) {
      const captured = JSON.stringify(requests, null, 2);
      const diagnosticText = JSON.stringify(diagnostics, null, 2);
      throw new Error(`${error instanceof Error ? error.message : String(error)}\n已捕获请求：${captured}\n运行诊断：${diagnosticText}${stdout.trim() ? `\nSidecar 标准输出：\n${stdout}` : ""}${stderr.trim() ? `\nSidecar 日志：\n${stderr}` : ""}`);
    } finally {
      await stopProcess(engine);
      provider.stop(true);
      rmSync(workspace, { recursive: true, force: true });
      rmSync(runtimeData, { recursive: true, force: true });
    }
  }, 60_000);
});
