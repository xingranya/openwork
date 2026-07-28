/** @jsxImportSource react */
import { useId } from "react";
import {
  Check,
  ChevronDown,
  Copy,
  Eye,
  EyeOff,
} from "lucide-react";

import {
  errorBannerClass,
  iconTileClass,
  inputClass,
  pillGhostClass,
  pillSecondaryClass,
  softCardClass,
  surfaceCardClass,
  warningBannerClass,
} from "./modal-styles";
import type { ShareField } from "./types";

const isInviteField = (label: string) => /invite link/i.test(label);
const isCollaboratorField = (label: string) =>
  /collaborator token/i.test(label);
const isPasswordField = (label: string) =>
  /owner token|connected token|access token|password/i.test(label);
const isWorkerUrlField = (label: string) => /worker url/i.test(label);

const displayFieldLabel = (field: ShareField) => {
  if (isCollaboratorField(field.label)) return "协作者访问令牌";
  if (isPasswordField(field.label)) return "访问密码";
  if (isWorkerUrlField(field.label)) return "Worker 地址";
  return /[\u3400-\u9fff]/.test(field.label) ? field.label : "连接信息";
};

function localizedShareMessage(message: string | null | undefined, fallback: string) {
  return message && /[\u3400-\u9fff]/.test(message) ? message : fallback;
}

type CredentialFieldProps = {
  field: ShareField;
  fieldKey: string;
  copiedKey: string | null;
  revealedByKey: Record<string, boolean>;
  onCopy: (value: string, key: string) => void;
  onToggleReveal: (key: string) => void;
};

function CredentialField(props: CredentialFieldProps) {
  const isSecret = Boolean(props.field.secret);
  const revealed = Boolean(props.revealedByKey[props.fieldKey]);

  return (
    <div>
      <label className="mb-1.5 block text-[13px] font-medium text-dls-text">
        {displayFieldLabel(props.field)}
      </label>
      <div className="relative flex items-center gap-2">
        <input
          type={isSecret && !revealed ? "password" : "text"}
          readOnly
          value={props.field.value || props.field.placeholder || ""}
          className={`${inputClass} font-mono text-[12px]`}
        />
        {isSecret ? (
          <button
            type="button"
            onClick={() => props.onToggleReveal(props.fieldKey)}
            disabled={!props.field.value}
            className={pillSecondaryClass}
            title={revealed ? "隐藏密码" : "显示密码"}
          >
            {revealed ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => props.onCopy(props.field.value, props.fieldKey)}
          disabled={!props.field.value}
          className={pillSecondaryClass}
          title="复制"
        >
          {props.copiedKey === props.fieldKey ? (
            <Check size={14} className="text-emerald-600" />
          ) : (
            <Copy size={14} />
          )}
        </button>
      </div>
      {props.field.hint?.trim() ? (
        <p className="mt-1.5 text-[12px] text-dls-secondary">
          {localizedShareMessage(props.field.hint, "请妥善保管此连接信息。")}
        </p>
      ) : null}
    </div>
  );
}

export type ShareWorkspaceAccessPanelProps = {
  fields: ShareField[];
  copiedKey: string | null;
  onCopy: (value: string, key: string) => void;
  revealedByKey: Record<string, boolean>;
  onToggleReveal: (key: string) => void;
  collaboratorExpanded: boolean;
  onToggleCollaboratorExpanded: () => void;
  remoteAccess?: {
    enabled: boolean;
    busy: boolean;
    error?: string | null;
    status?: string | null;
    onSave: (enabled: boolean) => void | Promise<void>;
  };
  remoteAccessEnabled: boolean;
  onRemoteAccessEnabledChange: (value: boolean) => void;
  note?: string | null;
};

export function ShareWorkspaceAccessPanel(
  props: ShareWorkspaceAccessPanelProps,
) {
  const remoteAccessToggleId = useId();
  const accessFields = props.fields.filter(
    (field) => !isInviteField(field.label),
  );
  const collaboratorField =
    accessFields.find((field) => isCollaboratorField(field.label)) ?? null;
  const primaryAccessFields = accessFields.filter(
    (field) => !isCollaboratorField(field.label),
  );
  const remoteAccessNeedsEnable = Boolean(
    props.remoteAccess && !props.remoteAccess.enabled && !props.remoteAccessEnabled,
  );
  const remoteSaveDisabled = props.remoteAccess
    ? props.remoteAccess.busy ||
      (props.remoteAccess.enabled &&
        props.remoteAccessEnabled === props.remoteAccess.enabled)
    : true;
  const remoteSaveLabel = props.remoteAccess?.busy
    ? "正在保存…"
    : remoteAccessNeedsEnable
      ? "启用远程访问"
      : props.remoteAccess?.enabled === false && props.remoteAccessEnabled
        ? "保存并重启 Worker"
        : "保存";

  return (
    <div className="space-y-5 pt-2 animate-in fade-in slide-in-from-right-4 duration-300">
      <div className={warningBannerClass}>
        <span className="leading-relaxed">
          {props.remoteAccess
            ? "这些凭据可以实时访问当前工作区。启用远程共享后，能够访问所在网络的人可能控制此 Worker，请仅提供给可信人员。"
            : "请仅与可信人员共享。这些凭据可以实时访问当前工作区。"}
        </span>
      </div>

      {props.remoteAccess ? (
        <div className={surfaceCardClass}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="text-[18px] font-semibold tracking-[-0.3px] text-dls-text">
                远程访问
              </h3>
              <p className="mt-1 text-[14px] leading-relaxed text-dls-secondary">
                默认关闭。只有需要从其他电脑连接此 Worker 时才启用。
              </p>
            </div>
            <label htmlFor={remoteAccessToggleId} className="relative inline-flex shrink-0 cursor-pointer items-center">
              <input
                id={remoteAccessToggleId}
                type="checkbox"
                aria-label="远程访问"
                className="peer sr-only"
                checked={props.remoteAccessEnabled}
                onChange={(event) =>
                  props.onRemoteAccessEnabledChange(event.currentTarget.checked)
                }
                disabled={props.remoteAccess.busy}
              />
              <div className="h-6 w-11 rounded-full bg-zinc-300 transition-colors peer-checked:bg-[var(--dls-accent)] peer-disabled:opacity-50 after:absolute after:left-[2px] after:top-[2px] after:h-5 after:w-5 after:rounded-full after:bg-white after:transition-transform peer-checked:after:translate-x-5" />
            </label>
          </div>

          <div className="mt-4 flex items-center justify-between gap-3">
            <div className="text-[13px] text-dls-secondary">
              {localizedShareMessage(props.remoteAccess.status,
                (props.remoteAccess.enabled
                  ? "远程访问当前已启用。"
                  : "远程访问当前已关闭。"))}
            </div>
            <button
              type="button"
              onClick={() => {
                if (remoteAccessNeedsEnable) {
                  props.onRemoteAccessEnabledChange(true);
                  return;
                }
                void props.remoteAccess?.onSave(props.remoteAccessEnabled);
              }}
              disabled={remoteSaveDisabled}
              className={pillSecondaryClass}
            >
              {remoteSaveLabel}
            </button>
          </div>

          {props.remoteAccess.error?.trim() ? (
            <div className={`mt-4 ${errorBannerClass}`}>
              {localizedShareMessage(props.remoteAccess.error, "保存远程访问设置失败，请稍后重试。")}
            </div>
          ) : null}
        </div>
      ) : null}

      {primaryAccessFields.length > 0 ? (
        <div className={surfaceCardClass}>
          <div className="mb-4 text-[13px] font-medium text-dls-text">
            连接信息
          </div>
          <div className="space-y-4">
            {primaryAccessFields.map((field) => (
              <div key={field.label}>
                <CredentialField
                  field={field}
                  fieldKey={`primary:${field.label}`}
                  copiedKey={props.copiedKey}
                  revealedByKey={props.revealedByKey}
                  onCopy={props.onCopy}
                  onToggleReveal={props.onToggleReveal}
                />
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div
          className={`${softCardClass} text-[13px] leading-relaxed text-dls-secondary`}
        >
          启用远程访问并保存后，SeeWayWork 会重启 Worker，并显示当前工作区的实时连接信息。
        </div>
      )}

      {collaboratorField ? (
        <div className="pt-1">
          <button
            type="button"
            className={pillGhostClass}
            onClick={props.onToggleCollaboratorExpanded}
            aria-expanded={props.collaboratorExpanded}
          >
            <span>协作者访问（可选）</span>
            <ChevronDown
              size={13}
              className={`shrink-0 transition-transform ${
                props.collaboratorExpanded ? "rotate-180" : ""
              }`}
            />
          </button>
          {props.collaboratorExpanded ? (
            <div className={`${softCardClass} mt-3`}>
              <div className="mb-3 text-[12px] text-dls-secondary">
                用于日常连接，不包含本机工具授权，也不代表项目审批权限。
              </div>
              <CredentialField
                field={collaboratorField}
                fieldKey={`collaborator:${collaboratorField.label}`}
                copiedKey={props.copiedKey}
                revealedByKey={props.revealedByKey}
                onCopy={props.onCopy}
                onToggleReveal={props.onToggleReveal}
              />
            </div>
          ) : null}
        </div>
      ) : null}

      {props.note?.trim() ? (
        <div className="px-1 text-[12px] text-dls-secondary">
          {localizedShareMessage(props.note, "请妥善保管工作区连接信息。")}
        </div>
      ) : null}
    </div>
  );
}
