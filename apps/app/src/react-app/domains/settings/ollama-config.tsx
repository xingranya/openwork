/** @jsxImportSource react */
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bot, CheckCircle2, Download, Loader2, RefreshCw, XCircle } from "lucide-react";

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
import { Checkbox } from "@/components/ui/checkbox";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
  FieldTitle,
} from "@/components/ui/field";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatFileSize } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { fetchOllamaModelSupportsVision, OLLAMA_PROVIDER_CONFIG, type LocalProviderInstallInput } from "./openai-image-extension";
import { registerExtensionConfig, type ExtensionConfigContext } from "./extension-registry";

const ollamaConfigFactory = (ctx: ExtensionConfigContext) => (
  <OllamaConfig
    busy={ctx.localProvider.busy}
    status={ctx.localProvider.status}
    error={ctx.localProvider.error}
    onInstall={ctx.localProvider.onInstall}
  />
);

registerExtensionConfig("openwork.ollama.settings", ollamaConfigFactory);
registerExtensionConfig("ollama", ollamaConfigFactory);

type OllamaModel = {
  name: string;
  model: string;
  modified_at: string;
  size: number;
  digest: string;
  details: {
    parent_model: string;
    format: string;
    family: string;
    families: string[];
    parameter_size: string;
    quantization_level: string;
  };
};

type OllamaStatus = "checking" | "running" | "unreachable";

function useOllamaModels() {
  const { data, isFetching, refetch } = useQuery({
    queryKey: ["ollama", "tags"],
    queryFn: async (): Promise<{ status: "running" | "unreachable"; models: OllamaModel[] }> => {
      try {
        const response = await fetch(`${OLLAMA_PROVIDER_CONFIG.baseURL.replace("/v1", "")}/api/tags`, {
          signal: AbortSignal.timeout(3000),
        });

        if (!response.ok) {
          return { status: "unreachable", models: [] };
        }

        const data = await response.json();

        return { status: "running", models: Array.isArray(data?.models) ? data.models : [] };
      } catch {
        return { status: "unreachable", models: [] };
      }
    },
    refetchOnWindowFocus: false,
  });

  const status: OllamaStatus = isFetching ? "checking" : (data?.status ?? "unreachable");

  return { data, isFetching, refetch, status };
}

type PullProgressUpdate = {
  status: string;
  completed?: number;
  total?: number;
};

type PullProgressState = PullProgressUpdate & {
  modelName: string;
};

function localizedOllamaProgress(status: string) {
  if (/[\u3400-\u9fff]/.test(status)) return status;
  if (status === "pulling manifest") return "正在获取模型清单…";
  if (status === "verifying sha256 digest") return "正在校验模型文件…";
  if (status === "writing manifest") return "正在写入模型清单…";
  if (status === "removing any unused layers") return "正在清理未使用的模型文件…";
  if (status === "success") return "模型下载完成。";
  if (status.startsWith("pulling ")) return "正在下载模型文件…";
  return "正在下载模型…";
}

function localizedOllamaMessage(message: string | null, fallback: string) {
  return message && /[\u3400-\u9fff]/.test(message) ? message : fallback;
}

async function pullOllamaModel(
  modelName: string,
  onProgress: (update: PullProgressUpdate) => void,
): Promise<boolean> {
  try {
    const response = await fetch(`${OLLAMA_PROVIDER_CONFIG.baseURL.replace("/v1", "")}/api/pull`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: modelName, stream: true }),
    });
    if (!response.ok || !response.body) return false;
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const parsed = JSON.parse(line);
          if (parsed.status) {
            onProgress({
              status: localizedOllamaProgress(parsed.status),
              completed: typeof parsed.completed === "number" ? parsed.completed : undefined,
              total: typeof parsed.total === "number" ? parsed.total : undefined,
            });
          }
          if (parsed.error) {
            onProgress({ status: "下载失败，请检查模型名称和网络连接。" });
            return false;
          }
        } catch {
          // 忽略无法解析的进度行。
        }
      }
    }
    return true;
  } catch {
    onProgress({ status: "下载失败，请检查 Ollama 和网络连接。" });
    return false;
  }
}

function usePullOllamaModel(options: { onSuccess?: (model: string) => void } = {}) {
  const queryClient = useQueryClient();
  const [progress, setProgress] = useState<PullProgressState | null>(null);

  const { mutateAsync: pullModel, isPending: isPulling } = useMutation({
    mutationFn: async (modelName: string) => {
      const model = modelName.trim();
      
      if (!model) {
        throw new Error("请输入模型名称。");
      }

      let latestProgress: PullProgressUpdate = { status: "正在准备下载…" };
      const updateProgress = (update: PullProgressUpdate) => {
        latestProgress = update;
        setProgress((current) => ({
          modelName: model,
          status: update.status,
          completed: update.completed ?? current?.completed,
          total: update.total ?? current?.total,
        }));
      };

      updateProgress(latestProgress);
      const ok = await pullOllamaModel(model, updateProgress);

      if (!ok) {
        if (latestProgress.status === "正在准备下载…") {
          setProgress({ modelName: model, status: `无法下载“${model}”。` });
        }
        throw new Error(`无法下载“${model}”。`);
      }

      return model;
    },
    onSuccess: async (model) => {
      await queryClient.invalidateQueries({ queryKey: ["ollama", "tags"] });
      setProgress(null);
      options.onSuccess?.(model);
    },
  });

  return { pullModel, isPulling, progress };
}

export type OllamaConfigProps = {
  busy: boolean;
  status: string | null;
  error: string | null;
  onInstall: (input: LocalProviderInstallInput) => void | Promise<void>;
};

export function OllamaConfig(props: OllamaConfigProps) {
  const [selectedModel, setSelectedModel] = useState("");
  const [customModel, setCustomModel] = useState(OLLAMA_PROVIDER_CONFIG.defaultModelId);
  const [pullDialogOpen, setPullDialogOpen] = useState(false);
  const [setDefault, setSetDefault] = useState(true);
  const [checkingCapabilities, setCheckingCapabilities] = useState(false);


  const { data, isFetching, refetch, status } = useOllamaModels();
  const { isPulling, pullModel, progress } = usePullOllamaModel({
    onSuccess: setSelectedModel,
  });

  const activeModelId = isPulling ? customModel.trim() : selectedModel;

  useEffect(() => {
    if (!selectedModel && data?.models?.[0]) {
      setSelectedModel(data.models[0].name);
    }
  }, [data, selectedModel]);

  const handlePull = async () => {
    const model = customModel.trim();

    if (!model) { 
      return; 
    }

    setPullDialogOpen(false);
    
    try {
      await pullModel(model);
    } catch {
      // 下载进度由 mutation 状态统一显示。
    }
  };

  const handleInstall = () => {
    if (!activeModelId) { 
      return; 
    }

    void (async () => {
      setCheckingCapabilities(true);
      try {
        const supportsVision = await fetchOllamaModelSupportsVision(activeModelId, OLLAMA_PROVIDER_CONFIG.baseURL);
        await props.onInstall({
          providerId: OLLAMA_PROVIDER_CONFIG.providerId,
          name: OLLAMA_PROVIDER_CONFIG.name,
          baseURL: OLLAMA_PROVIDER_CONFIG.baseURL,
          modelId: activeModelId,
          modelName: activeModelId,
          setDefault,
          supportsVision,
        });
      } finally {
        setCheckingCapabilities(false);
      }
    })();
  };

  if (status === "unreachable") {
    return (
      <Card variant="outline" size="sm">
        <CardHeader>
          <CardTitle>本地模型配置</CardTitle>
          <CardDescription>连接本机 Ollama 服务并选择模型。</CardDescription>
          <CardAction>
            <Button variant="ghost" size="icon-sm" onClick={() => void refetch()} disabled={isFetching}>
              <RefreshCw className={isFetching ? "animate-spin" : ""} />
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent className="space-y-4">
          {props.error ? (
            <Alert variant="destructive">
              <XCircle />
              <AlertDescription>{localizedOllamaMessage(props.error, "无法连接 Ollama，请检查本机服务。")}</AlertDescription>
            </Alert>
          ) : null}

          <Empty className="flex-none p-6" variant="ghost">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Download />
              </EmptyMedia>
              <EmptyTitle>Ollama 尚未安装或运行</EmptyTitle>
              <EmptyDescription>
                下载并启动 Ollama，即可在当前工作区使用开源模型。
              </EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button
                render={
                  <a href="https://ollama.com/download" target="_blank" rel="noopener noreferrer" />
                }
              >
                下载 Ollama
              </Button>
            </EmptyContent>
          </Empty>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card variant="outline" size="sm">
      <CardHeader>
        <CardTitle>本地模型配置</CardTitle>
        <CardDescription>连接本机 Ollama 服务并选择模型。</CardDescription>
        <CardAction>
          <Button variant="ghost" size="icon-sm" onClick={() => void refetch()} disabled={isFetching}>
            <RefreshCw className={isFetching ? "animate-spin" : ""} />
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-4">
        {props.error ? (
          <Alert variant="destructive">
            <XCircle />
            <AlertDescription>{localizedOllamaMessage(props.error, "Ollama 操作失败，请稍后重试。")}</AlertDescription>
          </Alert>
        ) : null}

        <Alert>
          {status === "checking" ? (
            <Loader2 className="animate-spin" />
          ) : status === "running" ? (
            <CheckCircle2 className="text-green-11!" />
          ) : (
            <XCircle  />
          )}
          <AlertDescription>
            {status === "checking"
              ? "正在检查 Ollama…"
              : status === "running"
                ? `Ollama 正在运行（${data?.models?.length ?? 0} 个模型）`
                : "无法连接 Ollama"}
          </AlertDescription>
        </Alert>

        {/* 模型选择 */}
        {status === "running" && (data?.models?.length ?? 0) > 0 ? (
          <div className="flex flex-col gap-2">
            <FieldSet className="gap-3">
              <FieldLegend variant="label">可用模型</FieldLegend>
              <FieldDescription>
                从 Ollama 已加载的模型中选择。
              </FieldDescription>
              <ModelList value={selectedModel} onValueChange={setSelectedModel}>
                {(data?.models ?? []).map((model) => (
                  <ModelListItem key={model.name} model={model} />
                ))}
              </ModelList>
            </FieldSet>
            {progress ? (
              <PullProgressRow progress={progress} isPulling={isPulling} />
            ) : null}
            <Button
              variant="link"
              size="sm"
              className="self-center"
              onClick={() => setPullDialogOpen(true)}
            >
              添加其他模型
            </Button>
          </div>
        ) : null}

        {/* 暂无模型 */}
        {status === "running" && (data?.models?.length ?? 0) === 0 && !isPulling && !progress ? (
          <Empty className="flex-none p-6" variant="ghost">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Download />
              </EmptyMedia>
              <EmptyTitle>尚未加载模型</EmptyTitle>
              <EmptyDescription>
                从 ollama.com/library 下载模型后即可开始使用。
              </EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button onClick={() => setPullDialogOpen(true)}>
                下载模型
              </Button>
            </EmptyContent>
          </Empty>
        ) : status === "running" && (data?.models?.length ?? 0) === 0 && progress ? (
          <PullProgressRow progress={progress} isPulling={isPulling} />
        ) : null}

        <PullModelDialog
          open={pullDialogOpen}
          onOpenChange={setPullDialogOpen}
          model={customModel}
          onModelChange={setCustomModel}
          onPull={() => void handlePull()}
        />

        {props.status ? (
          <Alert>
            <CheckCircle2 />
            <AlertDescription>{localizedOllamaMessage(props.status, "模型已添加到当前工作区。")}</AlertDescription>
          </Alert>
        ) : null}
      </CardContent>
      <CardFooter className="border-t border-border">
        <FieldGroup className="gap-3">
          <Field orientation="horizontal">
            <Checkbox
              id="ollama-set-default"
              name="ollama-set-default"
              checked={setDefault}
              onCheckedChange={setSetDefault}
              nativeButton
              render={<button type="button" />}
            />
            <FieldLabel htmlFor="ollama-set-default">设为当前工作区的默认模型</FieldLabel>
          </Field>
        </FieldGroup>
        <Button
          onClick={handleInstall}
          disabled={props.busy || isPulling || checkingCapabilities || !activeModelId || status !== "running"}
        >
          {(props.busy || checkingCapabilities) && <Loader2 className="size-4 animate-spin" />}
          添加到工作区
        </Button>
      </CardFooter>
    </Card>
  );
}

interface ModelListProps {
  value: string;
  onValueChange: (value: string) => void;
  children: React.ReactNode;
}

export function ModelList({ value, onValueChange, children }: ModelListProps) {
  return (
    <RadioGroup className="w-full gap-2" value={value} onValueChange={onValueChange}>
      {children}
    </RadioGroup>
  )
}

interface ModelListItemProps {
  model: OllamaModel;
}

function ModelListItem({ model }: ModelListItemProps) {
  return (
    <FieldLabel htmlFor={model.name}>
      <Field orientation="horizontal" size="sm">
        <RadioGroupItem value={model.name} id={model.name} />
        <FieldContent className="flex-row justify-between w-full">
          <FieldTitle>{model.name}</FieldTitle>
          <FieldDescription>{formatFileSize(model.size)}</FieldDescription>
        </FieldContent>
      </Field>
    </FieldLabel>
  )
}

type PullProgressRowProps = {
  progress: PullProgressState;
  isPulling: boolean;
};

function PullProgressRow({ progress, isPulling }: PullProgressRowProps) {
  const progressLabel = progress.total && progress.completed != null
    ? `${progress.status} (${Math.round((progress.completed / progress.total) * 100)}%)`
    : progress.status;

  return (
    <FieldLabel>
      <Field orientation="horizontal" size="sm">
        <div className="relative flex aspect-square size-4 shrink-0 items-center justify-center">
          {isPulling ? (
            <Loader2 className="size-4 animate-spin text-muted-foreground" aria-hidden />
          ) : null}
        </div>
        <FieldContent className="flex-row justify-between w-full">
          <FieldTitle>{progress.modelName}</FieldTitle>
          <FieldDescription>{progressLabel}</FieldDescription>
        </FieldContent>
      </Field>
    </FieldLabel>
  );
}

type PullModelDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  model: string;
  onModelChange: (model: string) => void;
  onPull: () => void;
};

function PullModelDialog(props: PullModelDialogProps) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="w-full max-w-md sm:max-w-md">
        <DialogHeader>
          <DialogTitle>下载模型</DialogTitle>
          <DialogDescription>
            从 ollama.com/library 下载模型到本机 Ollama。
          </DialogDescription>
        </DialogHeader>
        <FieldSet className="w-full">
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="ollama-model-pull">模型名称</FieldLabel>
              <Input
                id="ollama-model-pull"
                type="text"
                value={props.model}
                onChange={(event) => props.onModelChange(event.currentTarget.value)}
                placeholder={OLLAMA_PROVIDER_CONFIG.defaultModelId}
              />
              <FieldDescription>
                输入 ollama.com/library 中的模型名称。
              </FieldDescription>
            </Field>
          </FieldGroup>
        </FieldSet>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>
            取消
          </DialogClose>
          <Button onClick={props.onPull} disabled={!props.model.trim()}>
            <Download className="size-4" />
            下载 {props.model.trim() || "模型"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
