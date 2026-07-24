/** @jsxImportSource react */
import { useEffect, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, CircleAlert, Loader2, RefreshCw, Settings2 } from "lucide-react";

import { desktopBridge } from "@/app/lib/desktop";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ScrollArea, ScrollAreaViewport } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { registerExtensionConfig } from "./extension-registry";

// ---------------------------------------------------------------------------
// 类型
// ---------------------------------------------------------------------------

type PermissionResult = {
  ok: boolean;
  accessibility: boolean;
  screenRecording: boolean;
  error?: string;
};

type ComputerUseConfigProps = {
  connected: boolean;
  connecting: boolean;
  onConnect?: () => void | Promise<void>;
  onRefresh?: () => void | Promise<void>;
  onPermissionsChange?: (permissions: { accessibility: boolean; screenRecording: boolean }) => void;
};

// ---------------------------------------------------------------------------
// 注册
// ---------------------------------------------------------------------------

registerExtensionConfig("computer-use", (ctx) => (
  <ComputerUseConfig
    connected={ctx.computerUse?.connected ?? false}
    connecting={ctx.computerUse?.connecting ?? false}
    onConnect={ctx.computerUse?.onConnect}
    onRefresh={ctx.computerUse?.onRefresh}
    onPermissionsChange={ctx.computerUse?.onPermissionsChange}
  />
));

// ---------------------------------------------------------------------------
// 辅助函数
// ---------------------------------------------------------------------------

function hasDesktopBridge() {
  return typeof window !== "undefined" && Boolean(window.__OPENWORK_ELECTRON__?.invokeDesktop);
}

function parsePermissionResult(value: unknown): PermissionResult {
  if (typeof value !== "object" || value === null) {
    throw new Error("无法读取权限检查结果。");
  }
  return {
    ok: "ok" in value && value.ok === true,
    accessibility: "accessibility" in value && value.accessibility === true,
    screenRecording: "screenRecording" in value && value.screenRecording === true,
    error: "error" in value && typeof value.error === "string" ? value.error : undefined,
  };
}

const PERMISSIONS_QUERY_KEY = ["computer-use", "permissions"] as const;

// ---------------------------------------------------------------------------
// 组件
// ---------------------------------------------------------------------------

export function ComputerUseConfig({
  connected,
  connecting,
  onConnect,
  onRefresh,
  onPermissionsChange,
}: ComputerUseConfigProps) {
  const queryClient = useQueryClient();

  // 直接读取最新的系统权限状态，不依赖设置窗口是否打开。
  const {
    data: result = null,
    isFetching,
    error: checkError,
    refetch,
  } = useQuery({
    queryKey: PERMISSIONS_QUERY_KEY,
    queryFn: async () => parsePermissionResult(await desktopBridge.checkComputerUsePermissions()),
    enabled: hasDesktopBridge(),
    retry: false,
    refetchOnWindowFocus: false,
  });

  // 打开权限设置程序，并用返回结果更新缓存状态。
  const {
    mutate: grant,
    isPending: isGrantPending,
    error: grantError,
    reset: resetGrant,
  } = useMutation({
    mutationFn: async () => {
      if (!hasDesktopBridge()) {
        throw new Error("电脑控制仅支持 Mac，并且需要使用 FoxWork 桌面应用。");
      }

      return parsePermissionResult(await desktopBridge.openComputerUsePermissionSetup());
    },
    onSuccess: (next) => {
      queryClient.setQueryData(PERMISSIONS_QUERY_KEY, next);
    },
  });

  const isBusy = isFetching || isGrantPending;
  const rawError = (grantError ?? checkError)?.message ?? result?.error ?? null;
  const error = rawError ? localizeComputerUseError(rawError) : null;

  // 将最新权限状态同步给上层。
  useEffect(() => {
    if (result) {
      onPermissionsChange?.({ accessibility: result.accessibility, screenRecording: result.screenRecording });
    }
  }, [result, onPermissionsChange]);

  // 清除上次错误后重新读取权限。
  const verify = () => {
    if (!hasDesktopBridge()) {
      return;
    }

    resetGrant();
    void refetch();
  };

  const allGranted = result?.accessibility === true && result.screenRecording;

  return (
    <Card variant="outline" size="sm">
      <CardHeader>
        <CardTitle>电脑控制设置（仅支持 Mac）</CardTitle>
        <CardDescription>
          连接本机 MCP 服务，并授予控制应用所需的 macOS 权限。
        </CardDescription>
        <CardAction>
          <Button variant="ghost" size="icon-sm" onClick={() => void verify()} disabled={isBusy}>
            <RefreshCw className={cn(isBusy && "animate-spin")} />
          </Button>
        </CardAction>
      </CardHeader>

      <CardContent className="space-y-4">
        {error ? (
          <Alert variant="destructive">
            <CircleAlert />
            <AlertDescription className="break-words">{error}</AlertDescription>
          </Alert>
        ) : null}

        {/* 第一步：连接 MCP */}
        <SetupRow
          title="1. 连接电脑控制 MCP"
          description="将本机电脑控制服务加入当前工作区，供 AI 在你授权后操作应用。"
          complete={connected}
        >
          <Button
            className="min-h-10 w-full whitespace-normal text-center lg:w-auto"
            onClick={() => void onConnect?.()}
            disabled={!onConnect || connected || connecting}
          >
            {connecting ? <Loader2 className="size-4 shrink-0 animate-spin" /> : null}
            <span className="min-w-0 break-words">
              {connected ? "已配置" : connecting ? "正在连接…" : "连接 MCP"}
            </span>
          </Button>
        </SetupRow>

        {/* 第二步：授予系统权限 */}
        <SetupRow
          title="2. 授予 macOS 权限"
          description="打开 FoxWork 权限设置程序。授予两项权限后，在下方重新检查。"
          complete={allGranted}
        >
          <div className="flex w-full min-w-0 flex-col gap-3">
            <div className="grid gap-2">
              <Pill label="辅助功能" granted={result?.accessibility === true} checked={result !== null} />
              <Pill label="屏幕录制" granted={result?.screenRecording === true} checked={result !== null} />
            </div>

            <Button
              className="min-h-10 w-full justify-center whitespace-normal text-center"
              onClick={() => void grant()}
              disabled={isBusy}
            >
              {isBusy ? (
                <Loader2 className="size-4 shrink-0 animate-spin" />
              ) : (
                <Settings2 className="size-4 shrink-0" />
              )}
              <span className="min-w-0 wrap-break-word">
                {isBusy ? "正在打开…" : allGranted ? "重新打开设置程序" : "授予权限"}
              </span>
            </Button>
          </div>
        </SetupRow>
      </CardContent>

      <CardFooter className="border-t border-border">
        <div className="flex w-full flex-col gap-3">
          <p className="text-xs text-muted-foreground">
            {allGranted
              ? "权限已通过检查，现在可以让 AI 执行电脑控制任务。"
              : "在设置程序中授予权限后，请点击“检查权限”。"}
          </p>
          <div className="flex w-full justify-end gap-2">
            {onRefresh ? (
              <Button
                variant="outline"
                onClick={() => void onRefresh?.()}
              >
                刷新连接
              </Button>
            ) : null}
            <Button
              onClick={() => void verify()}
              disabled={isBusy}
            >
              {isBusy ? <Loader2 className="size-4 shrink-0 animate-spin" /> : null}
              检查权限
            </Button>
          </div>
        </div>
      </CardFooter>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// 子组件
// ---------------------------------------------------------------------------

interface SetupRowProps {
  title: string;
  description: string;
  complete: boolean;
  children: ReactNode;
}

function SetupRow(props: SetupRowProps) {
  return (
    <div className="rounded-xl border border-border bg-card p-3">
      <div className="flex flex-col gap-3">
        <div className="flex min-w-0 flex-1 gap-3">
          <StatusIcon complete={props.complete} />
          <div className="min-w-0">
            <div className="text-sm font-medium text-card-foreground">{props.title}</div>
            <div className="mt-1 text-xs leading-relaxed text-muted-foreground">{props.description}</div>
          </div>
        </div>
        <div className="w-full min-w-0">{props.children}</div>
      </div>
    </div>
  );
}

interface PillProps {
  label: string;
  granted: boolean;
  checked: boolean;
}

function Pill({ label, granted, checked }: PillProps) {
  return (
    <div className="flex min-w-0 items-center justify-between gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2">
      <div className="flex items-center gap-2 text-sm">
        <StatusIcon complete={granted} muted={!checked} />
        <span className="truncate">{label}</span>
      </div>
      <span
        className={cn(
          "shrink-0 text-xs font-medium",
          !checked && "text-muted-foreground",
          checked && granted && "text-green-11",
          checked && !granted && "text-amber-11",
        )}
      >
        {!checked ? "…" : granted ? "已授权" : "需要授权"}
      </span>
    </div>
  );
}

function localizeComputerUseError(message: string) {
  if (/[\u3400-\u9fff]/.test(message)) return message;
  return "无法检查电脑控制权限，请确认正在使用 FoxWork 桌面应用后重试。";
}

interface StatusIconProps {
  complete: boolean;
  muted?: boolean;
}

function StatusIcon(props: StatusIconProps) {
  if (props.complete) {
    return <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-green-11" />;
  }

  return (
    <CircleAlert
      className={cn("mt-0.5 size-4 shrink-0", props.muted ? "text-muted-foreground" : "text-amber-11")}
    />
  );
}
