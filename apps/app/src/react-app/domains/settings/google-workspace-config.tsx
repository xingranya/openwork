/** @jsxImportSource react */
import { useEffect, useState } from "react";
import { CalendarDays, CheckCircle2, FileText, Loader2, MailPlus, ShieldCheck, XCircle } from "lucide-react";

import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import type { GoogleWorkspaceAuthStatus, OpenworkServerClient } from "../../../app/lib/openwork-server";
import { usePlatform } from "../../kernel/platform";
import type { ExtensionConfigContext } from "./extension-registry";
import { registerExtensionRuntime } from "./extension-registry";

type BusyAction = "status" | "connect" | "disconnect" | "set-active" | "test" | "smoke-test" | "save-secret";
type OptionalFeature = "gmailRead" | "driveFull" | "calendarWrite" | "chat";

const OPTIONAL_FEATURES: { id: OptionalFeature; label: string; description: string }[] = [
  { id: "gmailRead", label: "读取 Gmail", description: "读取你的 Gmail 邮件和会话。" },
  { id: "driveFull", label: "完整访问 Google Drive", description: "搜索、读取和编辑云端硬盘中的全部文件，不限于通过 FoxWork 创建的文件。" },
  { id: "calendarWrite", label: "创建日历活动", description: "在 Google 日历中创建活动。" },
  { id: "chat", label: "Google Chat 聊天", description: "列出空间、读取消息并在 Google Chat 中发送消息。" },
];
type GoogleWorkspaceCommand = () => Promise<unknown>;
const DESKTOP_ACTION_TIMEOUT_MS = 6 * 60 * 1000;
const CONNECT_POLL_INTERVAL_MS = 1_000;
// 必须与 apps/server/src/extensions/google-workspace.ts 中的 GOOGLE_WORKSPACE_DESKTOP_CLIENT_ID 一致。
const OPENWORK_BUILTIN_GOOGLE_CLIENT_ID = "929071212606-pmkqimjhm2tnp68kbklnout0irllj99h.apps.googleusercontent.com";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function normalizeGoogleWorkspaceAccount(value: unknown): GoogleWorkspaceAuthStatus["account"] {
  if (!isRecord(value)) return null;
  return {
    accountId: typeof value.accountId === "string" ? value.accountId : null,
    email: typeof value.email === "string" ? value.email : null,
    name: typeof value.name === "string" ? value.name : null,
    picture: typeof value.picture === "string" ? value.picture : null,
    sub: typeof value.sub === "string" ? value.sub : null,
    scopes: normalizeStringList(value.scopes),
    connectedAt: typeof value.connectedAt === "string" ? value.connectedAt : null,
  };
}

function normalizeGoogleWorkspaceAccounts(value: unknown): GoogleWorkspaceAuthStatus["accounts"] {
  if (!Array.isArray(value)) return [];
  return value.map(normalizeGoogleWorkspaceAccount).filter((item): item is NonNullable<GoogleWorkspaceAuthStatus["account"]> => item !== null);
}

function normalizeGoogleWorkspaceSmokeTest(value: unknown): GoogleWorkspaceAuthStatus["smokeTest"] {
  if (!isRecord(value)) return null;
  return {
    driveFileId: typeof value.driveFileId === "string" ? value.driveFileId : null,
    driveFileName: typeof value.driveFileName === "string" ? value.driveFileName : null,
    gmailDraftId: typeof value.gmailDraftId === "string" ? value.gmailDraftId : null,
  };
}

function normalizeGoogleWorkspaceAuthStatus(value: unknown): GoogleWorkspaceAuthStatus {
  const record = isRecord(value) ? value : {};
  const vault = record.vault === "encrypted" || record.vault === "plaintext-dev" ? record.vault : "unavailable";
  return {
    configured: record.configured === true,
    missing: normalizeStringList(record.missing),
    customClient: record.customClient === true,
    vault,
    connected: record.connected === true,
    account: normalizeGoogleWorkspaceAccount(record.account),
    accounts: normalizeGoogleWorkspaceAccounts(record.accounts),
    activeAccountId: typeof record.activeAccountId === "string" ? record.activeAccountId : null,
    scopes: normalizeStringList(record.scopes),
    connectedAt: typeof record.connectedAt === "string" ? record.connectedAt : null,
    error: typeof record.error === "string" ? record.error : null,
    testStatus: typeof record.testStatus === "string" ? record.testStatus : null,
    smokeTest: normalizeGoogleWorkspaceSmokeTest(record.smokeTest),
  };
}

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function waitForGoogleWorkspaceConnection(client: OpenworkServerClient, flowId: string, expiresAt: number) {
  while (Date.now() < expiresAt + 5_000) {
    const result = await client.googleWorkspaceConnectStatus(flowId);
    if (result.status === "connected" && result.googleWorkspace) return result.googleWorkspace;
    if (result.status === "failed" || result.status === "expired") {
      throw new Error(result.error ?? "Google Workspace 连接未完成。");
    }
    await sleep(CONNECT_POLL_INTERVAL_MS);
  }
  throw new Error("Google Workspace OAuth 登录超时。");
}

function GoogleWorkspaceConfig({ openworkServerClient, hostOpenworkServerClient, onExtensionConnectionChange, restartLocalServer }: ExtensionConfigContext) {
  const platform = usePlatform();
  const [status, setStatus] = useState<GoogleWorkspaceAuthStatus | null>(null);
  const [busyAction, setBusyAction] = useState<BusyAction | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [clientSecret, setClientSecret] = useState("");
  const [customClientId, setCustomClientId] = useState("");
  const [customClientSecret, setCustomClientSecret] = useState("");
  const [optionalFeatures, setOptionalFeatures] = useState<Record<OptionalFeature, boolean>>({ gmailRead: false, driveFull: false, calendarWrite: false, chat: false });
  const serverAvailable = Boolean(openworkServerClient);
  const hostServerAvailable = Boolean(hostOpenworkServerClient);
  const canConnect = serverAvailable && status?.configured === true && status.vault !== "unavailable";
  const canTest = serverAvailable && status?.connected === true;

  const loadStatus = async (options: { clearError?: boolean } = {}) => {
    if (!openworkServerClient) return;
    setBusyAction("status");
    if (options.clearError !== false) setError(null);
    try {
      const result = normalizeGoogleWorkspaceAuthStatus(await openworkServerClient.googleWorkspaceStatus());
      setStatus(result);
      onExtensionConnectionChange?.("google-workspace", result.connected);
    } catch (err) {
      setError(err instanceof Error ? err.message : "无法读取 Google Workspace 状态。");
    } finally {
      setBusyAction(null);
    }
  };

  useEffect(() => {
    void loadStatus();
  }, [openworkServerClient]);

  const runDesktopAction = async (action: Exclude<BusyAction, "status">, command: GoogleWorkspaceCommand) => {
    if (!openworkServerClient) return;
    setBusyAction(action);
    setError(null);
    try {
      const result = await Promise.race([
        command(),
        new Promise<never>((_, reject) => {
          window.setTimeout(() => reject(new Error("Google Workspace 连接时间过长。请重试；如果浏览器已经提示授权成功，请重启 FoxWork。")), DESKTOP_ACTION_TIMEOUT_MS);
        }),
      ]);
      const next = normalizeGoogleWorkspaceAuthStatus(result);
      setStatus(next);
      onExtensionConnectionChange?.("google-workspace", next.connected);
    } catch (err) {
      setError(err instanceof Error ? err.message : `Google Workspace 操作失败（${action}）。`);
      await loadStatus({ clearError: false });
    } finally {
      setBusyAction(null);
    }
  };

  const connectGoogleWorkspace = async () => {
    if (!openworkServerClient) return null;
    const features = status?.customClient === true ? OPTIONAL_FEATURES.filter((feature) => optionalFeatures[feature.id]).map((feature) => feature.id) : [];
    const flow = await openworkServerClient.googleWorkspaceConnectStart({ features });
    platform.openLink(flow.authUrl);
    return waitForGoogleWorkspaceConnection(openworkServerClient, flow.flowId, flow.expiresAt);
  };

  const saveOauthEnv = async (entries: { key: string; value: string }[], onSaved: () => void) => {
    if (!hostOpenworkServerClient) {
      setError("Google OAuth 设置只能通过本机桌面客户端保存。");
      return;
    }
    setBusyAction("save-secret");
    setError(null);
    try {
      await hostOpenworkServerClient.upsertUserEnv(entries);
      await hostOpenworkServerClient.setUserEnvPendingChanges(true);
      onSaved();
      if (restartLocalServer) {
        const restarted = await restartLocalServer();
        if (!restarted) setError("Google OAuth 设置已保存，请重启 FoxWork 后使用。");
      } else {
        setError("Google OAuth 设置已保存，请重启 FoxWork 后使用。");
      }
      await loadStatus({ clearError: false });
    } catch (err) {
      setError(err instanceof Error ? err.message : "无法保存 Google OAuth 设置。");
    } finally {
      setBusyAction(null);
    }
  };

  const saveGoogleClientSecret = async () => {
    const value = clientSecret.trim();
    if (!value) {
      setError("请输入 Google OAuth 桌面客户端密钥。");
      return;
    }
    await saveOauthEnv([{ key: "GOOGLE_WORKSPACE_OAUTH_CLIENT_SECRET", value }], () => setClientSecret(""));
  };

  const saveCustomOauthClient = async () => {
    const id = customClientId.trim();
    const secret = customClientSecret.trim();
    if (!id || !secret) {
      setError("请输入你自己的 Google OAuth 桌面客户端 ID 和客户端密钥。");
      return;
    }
    if (id === OPENWORK_BUILTIN_GOOGLE_CLIENT_ID) {
      setError("这是 FoxWork 内置客户端 ID，不能用于读取 Gmail。请在 Google Cloud Console 的“API 和服务 > 凭据 > 创建 OAuth 客户端 ID > 桌面应用”中新建客户端，并在此填写客户端 ID。");
      return;
    }
    await saveOauthEnv(
      [
        { key: "GOOGLE_WORKSPACE_OAUTH_CLIENT_ID", value: id },
        { key: "GOOGLE_WORKSPACE_OAUTH_CLIENT_SECRET", value: secret },
      ],
      () => {
        setCustomClientId("");
        setCustomClientSecret("");
      },
    );
  };

  const connectedAccounts = status?.accounts.length ? status.accounts : status?.account ? [status.account] : [];

  return (
    <div className="space-y-4">
      {!serverAvailable ? (
        <Alert variant="warning">
          <ShieldCheck />
          <AlertTitle>需要 FoxWork 服务</AlertTitle>
          <AlertDescription>请先启动 FoxWork 服务，再连接 Google Workspace。</AlertDescription>
        </Alert>
      ) : null}

      {status?.connected ? (
        <Alert>
          <CheckCircle2 />
          <AlertTitle>已连接 Google Workspace</AlertTitle>
          <AlertDescription>
            {connectedAccounts.length === 1 && connectedAccounts[0]?.email ? `当前账号：${connectedAccounts[0].email}。` : `已连接 ${connectedAccounts.length} 个 Google 账号。`}
            {status.testStatus ? ` ${status.testStatus}` : ""}
          </AlertDescription>
        </Alert>
      ) : (
        <Alert variant="warning">
          <ShieldCheck />
          <AlertTitle>连接 Google Workspace</AlertTitle>
          <AlertDescription>
            连接后，FoxWork 可以按你的要求使用日历、指定的云端硬盘文件和 Gmail 草稿。
          </AlertDescription>
        </Alert>
      )}

      {status && !status.configured ? (
        <Alert variant="warning">
          <XCircle />
          <AlertTitle>尚未配置 Google OAuth 客户端</AlertTitle>
          <AlertDescription>添加 Google OAuth 桌面客户端密钥后即可连接 Google Workspace。</AlertDescription>
        </Alert>
      ) : null}

      {status && !status.configured ? (
        <Card variant="outline" size="sm">
          <CardHeader>
            <CardTitle>设置 Google OAuth</CardTitle>
            <CardDescription>
              请使用 Google Cloud OAuth 桌面客户端。FoxWork 已内置客户端 ID，只需在此粘贴对应的客户端密钥。
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Input
              type="password"
              value={clientSecret}
              onChange={(event) => setClientSecret(event.target.value)}
              placeholder="Google OAuth 桌面客户端密钥"
              autoComplete="off"
            />
            <p className="text-xs leading-relaxed text-muted-foreground">
              密钥会保存在 FoxWork 本机环境设置中，并在本机服务重启后生效。
            </p>
          </CardContent>
          <CardFooter>
            <Button disabled={busyAction === "save-secret" || !clientSecret.trim() || !hostServerAvailable} onClick={() => void saveGoogleClientSecret()}>
              {busyAction === "save-secret" ? <Loader2 className="size-4 animate-spin" /> : null}
              保存并应用
            </Button>
          </CardFooter>
        </Card>
      ) : null}

      {status?.vault === "unavailable" ? (
        <Alert variant="destructive">
          <XCircle />
          <AlertTitle>加密令牌存储不可用</AlertTitle>
          <AlertDescription>FoxWork 当前无法在这台电脑上安全保存 Google 连接。</AlertDescription>
        </Alert>
      ) : null}

      {error || status?.error ? (
        <Alert variant="destructive">
          <XCircle />
          <AlertTitle>Google Workspace 出错</AlertTitle>
          <AlertDescription>{error ?? status?.error}</AlertDescription>
        </Alert>
      ) : null}

      {status?.smokeTest ? (
        <Alert>
          <CheckCircle2 />
          <AlertTitle>权限检查完成</AlertTitle>
          <AlertDescription>日历、云端硬盘和 Gmail 草稿访问均已验证。</AlertDescription>
        </Alert>
      ) : null}

      <Card variant="outline" size="sm">
        <CardHeader>
          <CardTitle>FoxWork 可以做什么</CardTitle>
          <CardDescription>
            连接 Google Workspace 后，FoxWork 可以协助准备会议、处理指定文件和起草邮件。
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-2xl border border-border bg-card p-3">
            <CalendarDays className="mb-2 size-4 text-blue-11" />
            <div className="text-sm font-medium text-card-foreground">读取日历</div>
            <div className="mt-1 text-xs leading-relaxed text-muted-foreground">列出即将开始的活动，并提供会议背景。</div>
          </div>
          <div className="rounded-2xl border border-border bg-card p-3">
            <MailPlus className="mb-2 size-4 text-red-11" />
            <div className="text-sm font-medium text-card-foreground">Gmail 草稿</div>
            <div className="mt-1 text-xs leading-relaxed text-muted-foreground">只创建邮件草稿，不会直接发送。</div>
          </div>
          <div className="rounded-2xl border border-border bg-card p-3">
            <FileText className="mb-2 size-4 text-green-11" />
            <div className="text-sm font-medium text-card-foreground">指定的云端硬盘文件</div>
            <div className="mt-1 text-xs leading-relaxed text-muted-foreground">只读取你明确选择或通过 FoxWork 创建的文件。</div>
          </div>
        </CardContent>
      </Card>

      <Card variant="outline" size="sm">
        {connectedAccounts.length > 0 ? (
          <CardContent className="space-y-2 pt-6">
            {connectedAccounts.map((account) => (
              <div key={account.accountId ?? account.email ?? account.sub ?? "google-account"} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-card p-3">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-card-foreground">{account.email ?? account.name ?? "Google 账号"}</div>
                  <div className="text-xs text-muted-foreground">{account.accountId === status?.activeAccountId ? "扩展操作的默认账号" : "已连接"}</div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {account.accountId && account.accountId !== status?.activeAccountId ? (
                    <Button variant="outline" size="sm" disabled={Boolean(busyAction)} onClick={() => {
                      const accountId = account.accountId;
                      if (!accountId) return;
                      void runDesktopAction("set-active", () => openworkServerClient?.googleWorkspaceSetActiveAccount(accountId) ?? Promise.resolve(null));
                    }}>
                      {busyAction === "set-active" ? <Loader2 className="size-4 animate-spin" /> : null}
                      设为默认
                    </Button>
                  ) : null}
                  <Button variant="destructive" size="sm" disabled={Boolean(busyAction)} onClick={() => void runDesktopAction("disconnect", () => openworkServerClient?.googleWorkspaceDisconnect(account.accountId) ?? Promise.resolve(null))}>
                    断开连接
                  </Button>
                </div>
              </div>
            ))}
          </CardContent>
        ) : null}
        <CardFooter className="flex-wrap gap-2 justify-between">
          <div className="flex flex-wrap gap-2">
            <Button disabled={Boolean(busyAction) || !canConnect} onClick={() => void runDesktopAction("connect", connectGoogleWorkspace)}>
              {busyAction === "connect" ? <Loader2 className="size-4 animate-spin" /> : null}
              {status?.connected ? "添加其他 Google 账号" : "连接 Google 账号"}
            </Button>
            {connectedAccounts.length > 1 ? (
              <Button variant="destructive" disabled={Boolean(busyAction)} onClick={() => void runDesktopAction("disconnect", () => openworkServerClient?.googleWorkspaceDisconnect() ?? Promise.resolve(null))}>
                {busyAction === "disconnect" ? <Loader2 className="size-4 animate-spin" /> : null}
                全部断开
              </Button>
            ) : null}
            <Button variant="outline" disabled={Boolean(busyAction) || !canTest} onClick={() => void runDesktopAction("test", () => openworkServerClient?.googleWorkspaceTestConnection() ?? Promise.resolve(null))}>
              {busyAction === "test" ? <Loader2 className="size-4 animate-spin" /> : null}
              测试连接
            </Button>
            <Button variant="outline" disabled={Boolean(busyAction) || !canTest} onClick={() => void runDesktopAction("smoke-test", () => openworkServerClient?.googleWorkspaceRunScopeSmokeTest() ?? Promise.resolve(null))}>
              {busyAction === "smoke-test" ? <Loader2 className="size-4 animate-spin" /> : null}
              运行诊断
            </Button>
          </div>
        </CardFooter>
      </Card>

      <Accordion>
        <AccordionItem value="advanced">
          <AccordionTrigger>高级设置</AccordionTrigger>
          <AccordionContent className="space-y-4">
            <p className="text-xs leading-relaxed text-muted-foreground">
              使用你自己的 Google OAuth 客户端可以申请更多权限，例如读取 Gmail、完整访问云端硬盘、创建日历活动和使用 Google Chat。
            </p>
            {status?.customClient ? (
              <Alert>
                <CheckCircle2 />
                <AlertTitle>正在使用你自己的 Google OAuth 客户端</AlertTitle>
                <AlertDescription>可以选择下方的附加权限。</AlertDescription>
              </Alert>
            ) : (
              <div className="space-y-3">
                <Input
                  value={customClientId}
                  onChange={(event) => setCustomClientId(event.target.value)}
                  placeholder="你的 Google OAuth 桌面客户端 ID"
                  autoComplete="off"
                />
                <Input
                  type="password"
                  value={customClientSecret}
                  onChange={(event) => setCustomClientSecret(event.target.value)}
                  placeholder="你的 Google OAuth 桌面客户端密钥"
                  autoComplete="off"
                />
                <p className="text-xs leading-relaxed text-muted-foreground">
                  请在 Google Cloud Console 中创建桌面 OAuth 客户端，再粘贴客户端 ID 和密钥。它们会保存在 FoxWork 本机环境设置中，并在本机服务重启后生效。
                </p>
                <Button disabled={busyAction === "save-secret" || !customClientId.trim() || !customClientSecret.trim() || !hostServerAvailable} onClick={() => void saveCustomOauthClient()}>
                  {busyAction === "save-secret" ? <Loader2 className="size-4 animate-spin" /> : null}
                  保存并应用
                </Button>
              </div>
            )}
            <div className="space-y-3">
              <p className="text-xs leading-relaxed text-muted-foreground">
                {status?.customClient
                  ? "请选择是否允许下方各项附加权限。下次连接 Google 账号时会申请这些权限；已连接的账号需先断开再重新连接。"
                  : "请先在上方添加你自己的 Google OAuth 客户端，再设置这些选项。"}
              </p>
              {OPTIONAL_FEATURES.map((feature) => (
                <label key={feature.id} className="flex items-start gap-2.5">
                  <Checkbox
                    checked={optionalFeatures[feature.id]}
                    onCheckedChange={(checked) => setOptionalFeatures((current) => ({ ...current, [feature.id]: checked === true }))}
                    disabled={Boolean(busyAction) || status?.customClient !== true}
                    className="mt-0.5"
                  />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-card-foreground">{feature.label}</span>
                    <span className="block text-xs leading-relaxed text-muted-foreground">{feature.description}</span>
                  </span>
                </label>
              ))}
            </div>
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </div>
  );
}

registerExtensionRuntime({
  id: "google-workspace",
  settingsPanelRefs: ["openwork.googleWorkspace.settings"],
  settingsPanel: (ctx) => <GoogleWorkspaceConfig {...ctx} />,
  isConnected: (_entry, ctx) => ctx.extensionConnections?.["google-workspace"] === true,
});
