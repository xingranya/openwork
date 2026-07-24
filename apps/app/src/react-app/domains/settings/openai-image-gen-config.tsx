/** @jsxImportSource react */
import { useState } from "react";
import { CheckCircle2, Image, Loader2, PlusIcon, XCircle } from "lucide-react";

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
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { registerExtensionConfig, type ExtensionConfigContext } from "./extension-registry";

export type OpenAiImageGenConfigProps = {
  busy: boolean;
  status: string | null;
  error: string | null;
  envKeyDetected: boolean;
  onInstall: (apiKey: string) => void | Promise<void>;
  onTestGenerate: (input: { apiKey: string; prompt: string }) => void | Promise<void>;
};

const openAiImageGenConfigFactory = (ctx: ExtensionConfigContext) => (
  <OpenAiImageGenConfig
    busy={ctx.imageExtension.busy}
    status={ctx.imageExtension.status}
    error={ctx.imageExtension.error}
    envKeyDetected={ctx.imageExtension.envKeyDetected}
    onInstall={ctx.imageExtension.onInstall}
    onTestGenerate={ctx.imageExtension.onTestGenerate}
  />
);

registerExtensionConfig("openwork.imageGen.settings", openAiImageGenConfigFactory);
registerExtensionConfig("openai-image-gen", openAiImageGenConfigFactory);

const DEFAULT_PROMPT =
  "一台友好的机器人拿着画笔，青绿色霓虹界面边框，高对比度";

export function OpenAiImageGenConfig(props: OpenAiImageGenConfigProps) {
  const [apiKey, setApiKey] = useState("");
  const canSubmit = Boolean(apiKey.trim());

  return (
    <Card variant="outline" size="sm">
      <CardHeader>
        <CardTitle>图片生成配置</CardTitle>
        <CardDescription>使用 OpenAI API 密钥启用图片生成功能。</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {props.envKeyDetected ? (
          <Alert variant="warning">
            <Image />
            <AlertTitle>已从环境变量检测到 API 密钥</AlertTitle>
            <AlertDescription>
              已检测到 OPENAI_API_KEY。你在此保存的密钥将优先使用。
            </AlertDescription>
          </Alert>
        ) : null}

        <FieldGroup className="gap-4">
          <Field>
            <FieldLabel htmlFor="openai-image-api-key">OpenAI API 密钥</FieldLabel>
            <Input
              id="openai-image-api-key"
              type="password"
              value={apiKey}
              onChange={(event) => setApiKey(event.currentTarget.value)}
              placeholder="sk-..."
            />
            {props.envKeyDetected ? (
              <FieldDescription>
                保存后将覆盖 OPENAI_API_KEY 环境变量中的配置。
              </FieldDescription>
            ) : null}
          </Field>
        </FieldGroup>

        {props.status ? (
          <Alert>
            <CheckCircle2 />
            <AlertDescription>{props.status}</AlertDescription>
          </Alert>
        ) : null}
        {props.error ? (
          <Alert variant="destructive">
            <XCircle />
            <AlertDescription>{props.error}</AlertDescription>
          </Alert>
        ) : null}
      </CardContent>
      <CardFooter className="flex-wrap gap-2 border-t border-border justify-between">
        <Button
          onClick={() => void props.onInstall(apiKey)}
          disabled={props.busy || !canSubmit}
        >
          {props.busy && <Loader2 className="size-4 animate-spin" />}
          启用
        </Button>
        <Button
          variant="outline"
          onClick={() => void props.onTestGenerate({ apiKey, prompt: DEFAULT_PROMPT })}
          disabled={props.busy || !canSubmit}
        >
          生成测试图片
        </Button>
      </CardFooter>
    </Card>
  );
}
