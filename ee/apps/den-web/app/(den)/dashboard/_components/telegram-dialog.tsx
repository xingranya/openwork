"use client";

import { useEffect, useMemo, useState } from "react";
import { Bot, Check, Copy, ExternalLink, ShieldCheck, Trash2 } from "lucide-react";
import { DenButton } from "../../_components/ui/button";
import { DenInput } from "../../_components/ui/input";
import { DenSelect } from "../../_components/ui/select";
import { DenNotice } from "../../_components/ui/notice";
import { getErrorMessage, getWorkerStatusMeta } from "../../_lib/den-flow";
import { useDenFlow } from "../../_providers/den-flow-provider";
import {
  type TelegramPairing,
  useCreateTelegramPairing,
  useDeleteTelegramConnection,
  useSaveTelegramConnection,
  useTelegramConnection,
} from "./mcp-connections-data";

function pairingChatLabel(chat: { username: string | null; firstName: string | null }): string {
  if (chat.username) return `@${chat.username}`;
  return chat.firstName ?? "Telegram 私密会话";
}

export function TelegramDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const connectionQuery = useTelegramConnection(open);
  const saveConnection = useSaveTelegramConnection();
  const createPairing = useCreateTelegramPairing();
  const deleteConnection = useDeleteTelegramConnection();
  const { workers, workersLoadedOnce, workersBusy, refreshWorkers } = useDenFlow();
  const [botToken, setBotToken] = useState("");
  const [workerId, setWorkerId] = useState("");
  const [pairing, setPairing] = useState<TelegramPairing | null>(null);
  const [copied, setCopied] = useState(false);
  const [editing, setEditing] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const readyWorkers = useMemo(
    () => workers.filter((worker) => getWorkerStatusMeta(worker.status).bucket === "ready"),
    [workers],
  );
  const connection = connectionQuery.data ?? null;

  useEffect(() => {
    if (!open) return;
    setBotToken("");
    setPairing(null);
    setCopied(false);
    setEditing(false);
    setConfirmingDelete(false);
    setLocalError(null);
    if (!workersLoadedOnce) void refreshWorkers({ quiet: true, keepSelection: true });
  }, [open, refreshWorkers, workersLoadedOnce]);

  useEffect(() => {
    if (!open || connection?.pairing.paired) return;
    const timer = window.setInterval(() => void connectionQuery.refetch(), 2500);
    return () => window.clearInterval(timer);
  }, [open, connection?.pairing.paired, connectionQuery.refetch]);

  useEffect(() => {
    if (workerId || readyWorkers.length === 0) return;
    setWorkerId(connection?.worker.id ?? readyWorkers[0]?.workerId ?? "");
  }, [connection?.worker.id, readyWorkers, workerId]);

  if (!open) return null;

  const busy = saveConnection.isPending || createPairing.isPending || deleteConnection.isPending;
  const formError = localError ?? saveConnection.error ?? createPairing.error ?? deleteConnection.error ?? connectionQuery.error;
  const showSetup = !connection || editing;

  async function generatePairing() {
    setLocalError(null);
    setPairing(await createPairing.mutateAsync());
    setCopied(false);
  }

  async function save() {
    setLocalError(null);
    try {
      await saveConnection.mutateAsync({ botToken: botToken.trim(), workerId });
      setBotToken("");
      setEditing(false);
      await generatePairing();
      await connectionQuery.refetch();
    } catch (error) {
      setLocalError(getErrorMessage(error instanceof Error ? error.message : null, "连接 Telegram 失败。"));
    }
  }

  async function copyPairingLink() {
    if (!pairing) return;
    try {
      await navigator.clipboard.writeText(pairing.url);
      setCopied(true);
    } catch {
      setLocalError("无法复制配对链接，请直接打开。");
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 px-4 py-6" onClick={onClose}>
      <div
        data-testid="telegram-dialog"
        className="max-h-[calc(100vh-3rem)] w-full max-w-lg overflow-y-auto rounded-[28px] border border-gray-200 bg-white p-6 shadow-[0_24px_80px_-32px_rgba(15,23,42,0.45)]"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-sky-50 text-sky-600"><Bot className="h-5 w-5" /></span>
          <div>
            <h2 className="text-[18px] font-semibold tracking-[-0.02em] text-gray-950">{connection ? "Telegram 机器人" : "连接 Telegram"}</h2>
            <p className="mt-1 text-[13px] leading-6 text-gray-600">将一个私密会话连接到一个远程工作区。消息会成为助手任务，结果会回复到同一会话。</p>
          </div>
        </div>

        {connectionQuery.isLoading ? (
          <div className="mt-5 rounded-2xl border border-gray-100 bg-gray-50 p-4 text-[13px] text-gray-500">正在检查 Telegram 配置…</div>
        ) : null}

        {connection && !editing ? (
          <div className="mt-5 space-y-4">
            <div className={`rounded-2xl border p-4 ${connection.connected && connection.webhook.registered ? "border-emerald-100 bg-emerald-50" : "border-amber-100 bg-amber-50"}`}>
              <div className="flex items-center gap-2">
                <Check className={`h-4 w-4 ${connection.connected && connection.webhook.registered ? "text-emerald-600" : "text-amber-600"}`} />
                <p className="text-[13px] font-semibold text-gray-900">
                  {connection.connected && connection.webhook.registered ? "机器人和回调已连接" : "Telegram 需要处理"}
                </p>
              </div>
              <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[12px]">
                <dt className="text-gray-500">机器人</dt><dd className="font-medium text-gray-900">{connection.bot.username ? `@${connection.bot.username}` : connection.bot.displayName}</dd>
                <dt className="text-gray-500">远程工作区</dt><dd className="font-medium text-gray-900">{connection.worker.name}</dd>
                <dt className="text-gray-500">私密会话</dt><dd className="font-medium text-gray-900">{connection.pairing.chat ? pairingChatLabel(connection.pairing.chat) : "尚未配对"}</dd>
              </dl>
              {connection.webhook.lastError ? <p className="mt-2 text-[12px] text-amber-800">{getErrorMessage(connection.webhook.lastError, "Telegram 回调出现异常。")}</p> : null}
            </div>

            {connection.pairing.paired ? (
              <div data-testid="telegram-paired" className="rounded-2xl border border-gray-100 bg-white p-4">
                <div className="flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-emerald-600" /><p className="text-[13px] font-semibold text-gray-900">私密会话已配对</p></div>
                <p className="mt-1 text-[12px] leading-5 text-gray-500">只有此会话可以向远程工作区发送任务。如需更换会话，请重新生成配对链接。</p>
                <DenButton className="mt-3" variant="secondary" size="sm" disabled={busy} onClick={() => void generatePairing()}>配对其他会话</DenButton>
              </div>
            ) : !pairing ? (
              <div className="rounded-2xl border border-gray-100 bg-gray-50 p-4">
                <p className="text-[13px] font-semibold text-gray-900">配对私密会话</p>
                <p className="mt-1 text-[12px] leading-5 text-gray-500">生成一次性链接，在 Telegram 中打开，然后点击开始。</p>
                <DenButton className="mt-3" variant="primary" size="sm" loading={createPairing.isPending} onClick={() => void generatePairing()}>生成配对链接</DenButton>
              </div>
            ) : null}
          </div>
        ) : null}

        {pairing ? (
          <div data-testid="telegram-pairing" className="mt-4 rounded-2xl border border-sky-100 bg-sky-50 p-4">
            <p className="text-[13px] font-semibold text-gray-900">一次性配对链接</p>
            <p className="mt-1 text-[12px] leading-5 text-gray-600">请在需要授权的 Telegram 私密账号中打开此链接。有效期至 {new Date(pairing.expiresAt).toLocaleString("zh-CN")}。</p>
            <div className="mt-3 rounded-xl border border-sky-100 bg-white px-3 py-2 font-mono text-[11px] break-all text-gray-700">{pairing.url}</div>
            <div className="mt-3 flex flex-wrap gap-2">
              <a href={pairing.url} target="_blank" rel="noopener noreferrer" className="inline-flex h-9 items-center gap-2 rounded-lg bg-gray-900 px-3 text-[12px] font-medium text-white">打开 Telegram <ExternalLink className="h-3.5 w-3.5" /></a>
              <DenButton variant="secondary" size="sm" onClick={() => void copyPairingLink()}><Copy className="mr-1 h-3.5 w-3.5" />{copied ? "已复制" : "复制链接"}</DenButton>
            </div>
          </div>
        ) : null}

        {showSetup && !connectionQuery.isLoading ? (
          <div className="mt-5 space-y-4">
            <div className="rounded-2xl border border-gray-100 bg-gray-50 p-4">
              <p className="text-[13px] font-semibold text-gray-900">1. 创建 Telegram 机器人</p>
              <p className="mt-1 text-[12px] leading-5 text-gray-500">打开 {" "}<a href="https://t.me/BotFather" target="_blank" rel="noopener noreferrer" className="font-medium text-gray-900 underline decoration-gray-300 underline-offset-4">@BotFather</a>，执行 /newbot，并在下方粘贴令牌。FoxWork 会加密保存，之后不再显示。</p>
              <label className="mb-1.5 mt-3 block text-[12px] font-medium text-gray-700">机器人令牌</label>
              <DenInput data-testid="telegram-bot-token" type="password" autoComplete="off" value={botToken} onChange={(event) => setBotToken(event.target.value)} placeholder="123456789:AA…" />
            </div>
            <div className="rounded-2xl border border-gray-100 bg-gray-50 p-4">
              <p className="text-[13px] font-semibold text-gray-900">2. 选择可用的远程工作区</p>
              <p className="mt-1 text-[12px] leading-5 text-gray-500">每条接收的消息都会在此工作区中启动一项任务。</p>
              <div className="mt-3">
                <DenSelect aria-label="Telegram 远程工作区" data-testid="telegram-worker" value={workerId} disabled={workersBusy || readyWorkers.length === 0} onChange={(event) => setWorkerId(event.target.value)}>
                  {readyWorkers.length === 0 ? <option value="">暂无可用工作区</option> : readyWorkers.map((worker) => <option key={worker.workerId} value={worker.workerId}>{worker.workerName}</option>)}
                </DenSelect>
              </div>
            </div>
            <div className="rounded-2xl border border-amber-100 bg-amber-50 p-4 text-[12px] leading-5 text-amber-800">
              自托管环境需要稳定且可公开访问的 HTTPS FoxWork API 地址，Telegram 才能发送回调。当前仅支持私密文字会话，不支持群组、频道或媒体文件。
            </div>
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              {connection ? <DenButton variant="secondary" disabled={busy} onClick={() => setEditing(false)}>取消更改</DenButton> : null}
              <DenButton data-testid="save-telegram" variant="primary" loading={saveConnection.isPending} disabled={busy || !botToken.trim() || !workerId} onClick={() => void save()}>连接机器人</DenButton>
            </div>
          </div>
        ) : null}

        {formError ? <DenNotice message={getErrorMessage(formError instanceof Error ? formError.message : String(formError), "Telegram 操作失败，请重试。")} className="mt-3" /> : null}

        {connection && !editing ? (
          <div className="mt-5 border-t border-gray-100 pt-4">
            {confirmingDelete ? (
              <div className="rounded-2xl border border-red-100 bg-red-50 p-4">
                <p className="text-[13px] font-semibold text-red-900">断开此机器人？</p>
                <p className="mt-1 text-[12px] leading-5 text-red-700">回调、加密令牌和已配对会话都会被移除，Telegram 消息将立即停止。</p>
                <div className="mt-3 flex gap-2"><DenButton variant="secondary" size="sm" disabled={busy} onClick={() => setConfirmingDelete(false)}>保持连接</DenButton><DenButton variant="destructive" size="sm" loading={deleteConnection.isPending} onClick={async () => { await deleteConnection.mutateAsync(); setPairing(null); setConfirmingDelete(false); }}>断开连接</DenButton></div>
              </div>
            ) : (
              <div className="flex flex-wrap justify-between gap-2">
                <DenButton variant="secondary" size="sm" disabled={busy} onClick={() => { setWorkerId(connection.worker.id); setEditing(true); }} >更换机器人或工作区</DenButton>
                <DenButton variant="secondary" size="sm" disabled={busy} onClick={() => setConfirmingDelete(true)}><Trash2 className="mr-1 h-3.5 w-3.5" />断开连接</DenButton>
              </div>
            )}
          </div>
        ) : null}

        <div className="mt-5 flex justify-end"><DenButton variant="secondary" disabled={busy} onClick={onClose}>关闭</DenButton></div>
      </div>
    </div>
  );
}
