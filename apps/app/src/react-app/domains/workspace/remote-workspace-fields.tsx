/** @jsxImportSource react */
import type { Ref } from "react";
import { Globe } from "lucide-react";

import {
  iconTileClass,
  inputClass,
  inputHintClass,
  inputLabelClass,
  pillSecondaryClass,
  surfaceCardClass,
} from "./modal-styles";

export type RemoteWorkspaceFieldsProps = {
  hostUrl: string;
  onHostUrlInput: (value: string) => void;
  token: string;
  tokenVisible: boolean;
  onTokenInput: (value: string) => void;
  onToggleTokenVisible: () => void;
  displayName: string;
  onDisplayNameInput: (value: string) => void;
  directory?: string;
  onDirectoryInput?: (value: string) => void;
  showDirectory?: boolean;
  submitting?: boolean;
  hostInputRef?: Ref<HTMLInputElement>;
  title: string;
  description: string;
};

export function RemoteWorkspaceFields({
  hostUrl,
  onHostUrlInput,
  token,
  tokenVisible,
  onTokenInput,
  onToggleTokenVisible,
  displayName,
  onDisplayNameInput,
  directory,
  onDirectoryInput,
  showDirectory,
  submitting,
  hostInputRef,
  title,
  description,
}: RemoteWorkspaceFieldsProps) {
  return (
    <div className={surfaceCardClass}>
      <div className="flex items-start gap-3">
        <div className={iconTileClass}>
          <Globe size={17} />
        </div>
        <div className="min-w-0">
          <div className="text-[15px] font-medium tracking-[-0.2px] text-dls-text">
            {title}
          </div>
          <div className="mt-1 text-[13px] leading-relaxed text-dls-secondary">
            {description}
          </div>
        </div>
      </div>

      <div className="mt-5 grid gap-4">
        <label className="grid gap-2">
          <span className={inputLabelClass}>Worker 地址</span>
          <input
            ref={hostInputRef}
            type="url"
            value={hostUrl}
            onChange={(event) => onHostUrlInput(event.currentTarget.value)}
            placeholder="https://worker.example.com"
            disabled={submitting}
            className={inputClass}
          />
          <span className={inputHintClass}>
            粘贴要连接的 FoxWork Worker 地址。
          </span>
        </label>

        <label className="grid gap-2">
          <span className={inputLabelClass}>访问令牌</span>
          <div className="flex items-center gap-2 rounded-xl border border-dls-border bg-dls-surface p-1.5">
            <input
              type={tokenVisible ? "text" : "password"}
              value={token}
              onChange={(event) => onTokenInput(event.currentTarget.value)}
              placeholder="可选"
              disabled={submitting}
              className="min-w-0 flex-1 border-none bg-transparent px-2 py-1.5 text-[14px] text-dls-text outline-none placeholder:text-dls-secondary"
            />
            <button
              type="button"
              className={pillSecondaryClass}
              onClick={onToggleTokenVisible}
              disabled={submitting}
            >
              {tokenVisible ? "隐藏" : "显示"}
            </button>
          </div>
          <span className={inputHintClass}>
            仅在 Worker 要求时填写访问令牌。
          </span>
        </label>

        {showDirectory ? (
          <label className="grid gap-2">
            <span className={inputLabelClass}>远程目录</span>
            <input
              type="text"
              value={directory ?? ""}
              onChange={(event) => onDirectoryInput?.(event.currentTarget.value)}
              placeholder="可选"
              disabled={submitting}
              className={inputClass}
            />
            <span className={inputHintClass}>
              可指定远程 Worker 中的工作目录。
            </span>
          </label>
        ) : null}

        <label className="grid gap-2">
          <span className={inputLabelClass}>
            显示名称{" "}
            <span className="font-normal text-dls-secondary">（可选）</span>
          </span>
          <input
            type="text"
            value={displayName}
            onChange={(event) => onDisplayNameInput(event.currentTarget.value)}
            placeholder="Worker 名称"
            disabled={submitting}
            className={inputClass}
          />
        </label>
      </div>
    </div>
  );
}
