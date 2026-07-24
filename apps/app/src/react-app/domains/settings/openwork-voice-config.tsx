/** @jsxImportSource react */
import { useState } from "react";
import { CheckCircle2, Loader2, Mic2, XCircle } from "lucide-react";

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

export type OpenWorkVoiceConfigProps = {
  busy: boolean;
  status: string | null;
  error: string | null;
  envKeyDetected: boolean;
  onSaveApiKey: (apiKey: string) => void | Promise<void>;
  onTestSession: () => void | Promise<void>;
};

const openWorkVoiceConfigFactory = (ctx: ExtensionConfigContext) => (
  <OpenWorkVoiceConfig
    busy={ctx.voiceExtension.busy}
    status={ctx.voiceExtension.status}
    error={ctx.voiceExtension.error}
    envKeyDetected={ctx.voiceExtension.envKeyDetected}
    onSaveApiKey={ctx.voiceExtension.onSaveApiKey}
    onTestSession={ctx.voiceExtension.onTestSession}
  />
);

registerExtensionConfig("openwork.voice.settings", openWorkVoiceConfigFactory);
registerExtensionConfig("openwork-voice", openWorkVoiceConfigFactory);

export function OpenWorkVoiceConfig(props: OpenWorkVoiceConfigProps) {
  const [apiKey, setApiKey] = useState("");
  const canSave = Boolean(apiKey.trim());

  return (
    <Card variant="outline" size="sm">
      <CardHeader>
        <CardTitle>实时语音</CardTitle>
        <CardDescription>
          语音模式使用 OpenAI Realtime，并通过 FoxWork 界面控制 MCP 操作当前应用。
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {props.envKeyDetected ? (
          <Alert>
            <Mic2 />
            <AlertTitle>已找到 OpenAI 密钥</AlertTitle>
            <AlertDescription>
              优先使用 OPENAI_REALTIME_API_KEY，未配置时使用 FoxWork 环境变量中的 OPENAI_API_KEY。
            </AlertDescription>
          </Alert>
        ) : null}

        <FieldGroup className="gap-4">
          <Field>
            <FieldLabel htmlFor="openwork-voice-api-key">OpenAI API 密钥</FieldLabel>
            <Input
              id="openwork-voice-api-key"
              type="password"
              value={apiKey}
              onChange={(event) => setApiKey(event.currentTarget.value)}
              placeholder="sk-..."
            />
            <FieldDescription>
              密钥以 OPENAI_API_KEY 保存在 FoxWork 本机环境设置中，界面进程只会收到短期 Realtime 客户端密钥。
            </FieldDescription>
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
        <Button onClick={() => void props.onSaveApiKey(apiKey)} disabled={props.busy || !canSave}>
          {props.busy ? <Loader2 data-icon="inline-start" className="animate-spin" /> : null}
          保存密钥
        </Button>
        <Button variant="outline" onClick={() => void props.onTestSession()} disabled={props.busy || !props.envKeyDetected}>
          测试实时语音
        </Button>
      </CardFooter>
    </Card>
  );
}
