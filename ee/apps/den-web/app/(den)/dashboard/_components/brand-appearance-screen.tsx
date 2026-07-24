"use client";

import { ImageUp, Palette, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { getErrorMessage, getRequestError, requestJson } from "../../_lib/den-flow";
import {
  getManagedBrandAssetFromMetadata,
  parseOrganizationMetadata,
  type DenManagedBrandAsset,
} from "../../_lib/den-org";
import { DashboardPageTemplate } from "../../_components/ui/dashboard-page-template";
import { DenButton } from "../../_components/ui/button";
import { DenCard } from "../../_components/ui/card";
import { DenInput } from "../../_components/ui/input";
import { DenNotice } from "../../_components/ui/notice";
import { useOrgDashboard } from "../_providers/org-dashboard-provider";
import { EnterprisePlanNotice } from "./enterprise-plan-notice";

const BRAND_ASSET_MAX_BYTES = 2 * 1024 * 1024;
const ACCENT_COLOR_OPTIONS = [
  ["blue", "蓝色"],
  ["violet", "蓝紫色"],
  ["purple", "紫色"],
  ["indigo", "靛蓝色"],
  ["iris", "鸢尾紫"],
  ["crimson", "深红色"],
  ["red", "红色"],
  ["ruby", "宝石红"],
  ["pink", "粉色"],
  ["plum", "梅子紫"],
  ["orange", "橙色"],
  ["tomato", "番茄红"],
  ["gold", "金色"],
  ["green", "绿色"],
  ["grass", "草绿色"],
  ["jade", "翡翠绿"],
  ["teal", "青绿色"],
  ["cyan", "青色"],
  ["sky", "天蓝色"],
] as const;

type BrandAssetKind = "logo" | "icon";

type BrandAssetDraft = {
  file: File;
  previewUrl: string;
  width: number;
  height: number;
};

async function createBrandAssetDraft(file: File, kind: BrandAssetKind): Promise<BrandAssetDraft> {
  if (file.type !== "image/png" && file.type !== "image/jpeg") throw new Error("请选择 PNG 或 JPEG 图片。");
  if (file.size > BRAND_ASSET_MAX_BYTES) throw new Error("图片大小不能超过 2 MB。");

  let image: ImageBitmap;
  try {
    image = await createImageBitmap(file);
  } catch {
    throw new Error("FoxWork 无法读取这张图片，请更换文件。");
  }

  const { width, height } = image;
  image.close();
  if (width > 4096 || height > 4096) throw new Error("图片尺寸不能超过 4096×4096 像素。");
  if (kind === "icon") {
    if (width < 64 || height < 64) throw new Error("应用图标至少需要 64×64 像素。");
    if (width !== height) throw new Error("应用图标必须使用正方形图片。");
  } else {
    const aspectRatio = width / height;
    if (width < 128 || height < 32) throw new Error("品牌字标至少需要 128×32 像素。");
    if (aspectRatio < 1.5 || aspectRatio > 8) throw new Error("品牌字标必须为横向图片，宽高比应在 1.5:1 到 8:1 之间。");
  }

  return { file, previewUrl: URL.createObjectURL(file), width, height };
}

function BrandAssetUploadField({
  kind,
  title,
  description,
  currentUrl,
  managedAsset,
  draft,
  clearPending,
  disabled,
  onSelect,
  onClear,
}: {
  kind: BrandAssetKind;
  title: string;
  description: string;
  currentUrl: string | null;
  managedAsset: DenManagedBrandAsset | null;
  draft: BrandAssetDraft | null;
  clearPending: boolean;
  disabled: boolean;
  onSelect: (file: File | null) => void;
  onClear: () => void;
}) {
  const inputId = `brand-${kind}-upload`;
  const previewUrl = draft?.previewUrl ?? (clearPending ? null : currentUrl);
  const dimensions = draft
    ? `${draft.width}×${draft.height}`
    : managedAsset
      ? `${managedAsset.width}×${managedAsset.height}`
      : null;

  return (
    <div className="grid min-w-0 gap-3 rounded-2xl border border-gray-200 bg-white p-4" data-testid={`brand-${kind}-asset-field`}>
      <div className="grid gap-1">
        <span className="text-[14px] font-medium text-gray-800">{title}</span>
        <span className="text-[11px] leading-5 text-gray-400">{description}</span>
      </div>
      <div className="flex min-h-28 items-center justify-center overflow-hidden rounded-xl border border-dashed border-gray-200 bg-gray-50 p-4">
        {previewUrl ? (
          <img
            src={previewUrl}
            alt={`${title}预览`}
            className={kind === "icon" ? "size-20 rounded-xl object-contain" : "max-h-20 max-w-full object-contain"}
            data-testid={`brand-${kind}-preview`}
          />
        ) : (
          <span className="text-center text-[12px] text-gray-400">默认{kind === "icon" ? "应用图标" : "品牌字标"}</span>
        )}
      </div>
      <div className="min-h-9 min-w-0 break-words text-[11px] leading-5 text-gray-500" data-testid={`brand-${kind}-status`}>
        {draft ? `等待上传：${draft.file.name} · ${dimensions}` : null}
        {!draft && clearPending ? "保存后恢复默认图片。" : null}
        {!draft && !clearPending && managedAsset ? `已保存在公司服务中 · ${dimensions} · 版本 ${managedAsset.version.slice(0, 10)}` : null}
        {!draft && !clearPending && !managedAsset && currentUrl ? "当前使用外部图片地址。上传文件后会转存到公司服务。" : null}
        {!draft && !clearPending && !currentUrl ? "尚未保存自定义图片。" : null}
      </div>
      <div className="flex flex-wrap gap-2">
        <label
          htmlFor={inputId}
          className={[
            "inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3.5 text-[12px] font-medium text-gray-700 transition-colors hover:border-gray-300 hover:bg-gray-50",
            disabled ? "pointer-events-none opacity-60" : "",
          ].join(" ")}
        >
          <ImageUp size={13} aria-hidden="true" />
          {previewUrl ? "更换图片" : "选择图片"}
        </label>
        <input
          id={inputId}
          type="file"
          accept="image/png,image/jpeg"
          className="sr-only"
          disabled={disabled}
          onClick={(event) => { event.currentTarget.value = ""; }}
          onChange={(event) => onSelect(event.target.files?.item(0) ?? null)}
        />
        <DenButton type="button" variant="secondary" size="sm" icon={Trash2} disabled={disabled || !previewUrl} onClick={onClear}>
          清除
        </DenButton>
      </div>
    </div>
  );
}

export function BrandAppearanceScreen() {
  const {
    activeOrg,
    orgContext,
    orgBusy,
    orgError,
    mutationBusy,
    runReauthableAction,
    updateOrganizationSettings,
  } = useOrgDashboard();
  const [appNameDraft, setAppNameDraft] = useState("");
  const [accentColorDraft, setAccentColorDraft] = useState("");
  const [logoDraft, setLogoDraft] = useState<BrandAssetDraft | null>(null);
  const [iconDraft, setIconDraft] = useState<BrandAssetDraft | null>(null);
  const [logoClearPending, setLogoClearPending] = useState(false);
  const [iconClearPending, setIconClearPending] = useState(false);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [pageError, setPageError] = useState<string | null>(null);
  const [pageSuccess, setPageSuccess] = useState<string | null>(null);

  const isOwner = orgContext?.currentMember.isOwner ?? false;
  const metadata = parseOrganizationMetadata(orgContext?.organization.metadata ?? null);
  const currentLogoUrl = typeof metadata?.brandLogoUrl === "string" ? metadata.brandLogoUrl : null;
  const currentIconUrl = typeof metadata?.brandIconUrl === "string" ? metadata.brandIconUrl : null;
  const currentLogoAsset = getManagedBrandAssetFromMetadata(orgContext?.organization.metadata ?? null, "logo");
  const currentIconAsset = getManagedBrandAssetFromMetadata(orgContext?.organization.metadata ?? null, "icon");
  const logoPreviewUrl = logoDraft?.previewUrl ?? (logoClearPending ? null : currentLogoUrl);
  const iconPreviewUrl = iconDraft?.previewUrl ?? (iconClearPending ? null : currentIconUrl);

  useEffect(() => {
    if (!orgContext) return;
    const nextMetadata = parseOrganizationMetadata(orgContext.organization.metadata);
    setAppNameDraft(typeof nextMetadata?.brandAppName === "string" ? nextMetadata.brandAppName : "");
    setAccentColorDraft(typeof nextMetadata?.brandAccentColor === "string" ? nextMetadata.brandAccentColor : "");
    setLogoDraft(null);
    setIconDraft(null);
    setLogoClearPending(false);
    setIconClearPending(false);
  }, [orgContext]);

  useEffect(() => () => {
    if (logoDraft) URL.revokeObjectURL(logoDraft.previewUrl);
  }, [logoDraft]);

  useEffect(() => () => {
    if (iconDraft) URL.revokeObjectURL(iconDraft.previewUrl);
  }, [iconDraft]);

  if (orgBusy && !orgContext) {
    return <div className="mx-auto max-w-[860px] p-8 text-[14px] text-gray-500">正在加载品牌外观...</div>;
  }

  if (!activeOrg || !orgContext) {
    return <DenNotice message={getErrorMessage(orgError, "暂时无法加载品牌外观设置。")} className="m-8" />;
  }

  async function handleAssetSelection(kind: BrandAssetKind, file: File | null) {
    setPageError(null);
    if (!file) return;
    try {
      const draft = await createBrandAssetDraft(file, kind);
      if (kind === "logo") {
        setLogoDraft(draft);
        setLogoClearPending(false);
      } else {
        setIconDraft(draft);
        setIconClearPending(false);
      }
    } catch (error) {
      setPageError(getErrorMessage(error, "无法验证这张图片，请更换文件。"));
    }
  }

  function handleAssetClear(kind: BrandAssetKind) {
    setPageError(null);
    if (kind === "logo") {
      setLogoDraft(null);
      setLogoClearPending(true);
    } else {
      setIconDraft(null);
      setIconClearPending(true);
    }
  }

  async function handleSave(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPageError(null);
    setPageSuccess(null);

    try {
      if (logoDraft || iconDraft) {
        setUploadBusy(true);
        await runReauthableAction("upload-brand-assets", async () => {
          const body = new FormData();
          if (logoDraft) body.set("logo", logoDraft.file);
          if (iconDraft) body.set("icon", iconDraft.file);
          const { response, payload } = await requestJson("/v1/org/brand-assets", { method: "POST", body }, 30000);
          if (!response.ok) throw getRequestError(payload, response, `上传品牌图片失败（${response.status}）。`);
        });
      }

      await updateOrganizationSettings({
        brandAppName: appNameDraft.trim() || null,
        brandAccentColor: accentColorDraft || null,
        ...(logoClearPending ? { brandLogoUrl: null } : {}),
        ...(iconClearPending ? { brandIconUrl: null } : {}),
      });
      setPageSuccess("品牌外观已更新。");
    } catch (error) {
      setPageError(getErrorMessage(error, "更新品牌外观失败，请重试。"));
    } finally {
      setUploadBusy(false);
    }
  }

  const saveBusy = uploadBusy || mutationBusy === "update-organization-settings";

  return (
    <div data-testid="brand-appearance-screen">
      <DashboardPageTemplate
        icon={Palette}
        title="品牌外观"
        description="统一设置公司在 FoxWork 中显示的名称、字标、图标和强调色。"
        colors={["#F5F3FF", "#4C1D95", "#8B5CF6", "#DDD6FE"]}
      >
        {!orgContext.entitlements.desktopPolicies ? (
          <EnterprisePlanNotice feature="品牌外观定制" />
        ) : (
          <form className="grid gap-6" onSubmit={handleSave}>
            {pageError ? <DenNotice message={pageError} /> : null}
            {pageSuccess ? <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-4 text-[14px] text-emerald-700">{pageSuccess}</div> : null}

            <DenCard size="spacious" className="grid gap-6">
              <div className="grid gap-2">
                <p className="text-[12px] font-semibold uppercase tracking-[0.16em] text-violet-500">公司品牌</p>
                <h2 className="text-[24px] font-semibold tracking-[-0.04em] text-gray-900">客户端标识</h2>
                <p className="text-[14px] text-gray-500">保存前可以预览公司名称、品牌字标、应用图标和强调色。</p>
              </div>

              <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_280px]">
                <div className="grid gap-5">
                  <label className="grid gap-3">
                    <span className="text-[14px] font-medium text-gray-700">应用名称</span>
                    <DenInput type="text" value={appNameDraft} onChange={(event) => setAppNameDraft(event.target.value)} placeholder="FoxWork" maxLength={64} disabled={!isOwner} />
                    <span className="text-[11px] text-gray-400">已签名的应用标识固定为 FoxWork。</span>
                  </label>

                  <label className="grid gap-3">
                    <span className="text-[14px] font-medium text-gray-700">强调色</span>
                    <select value={accentColorDraft} onChange={(event) => setAccentColorDraft(event.target.value)} disabled={!isOwner} className="h-11 rounded-xl border border-gray-200 bg-white px-4 text-[14px] text-gray-900 outline-none">
                      <option value="">默认（FoxWork）</option>
                      {ACCENT_COLOR_OPTIONS.map(([color, label]) => (
                        <option key={color} value={color}>{label}</option>
                      ))}
                    </select>
                  </label>
                </div>

                <div className="overflow-hidden rounded-2xl border border-gray-200 bg-gray-950 p-5 text-white">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/50">预览</p>
                  <div className="mt-8 flex items-center gap-3">
                    {iconPreviewUrl ? <img src={iconPreviewUrl} alt="应用图标预览" className="size-12 rounded-xl bg-white object-contain" /> : <div className="flex size-12 items-center justify-center rounded-xl bg-white text-[14px] font-semibold text-gray-950">FW</div>}
                    <div className="min-w-0">
                      {logoPreviewUrl ? <img src={logoPreviewUrl} alt="品牌字标预览" className="mb-1 max-h-7 max-w-40 object-contain object-left brightness-0 invert" /> : null}
                      <p className="truncate text-[15px] font-medium">{appNameDraft.trim() || "FoxWork"}</p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="grid min-w-0 gap-5 lg:grid-cols-2">
                <BrandAssetUploadField kind="logo" title="品牌字标" description="横向 PNG 或 JPEG，尺寸 128×32 至 4096×4096，不超过 2 MB。" currentUrl={currentLogoUrl} managedAsset={currentLogoAsset} draft={logoDraft} clearPending={logoClearPending} disabled={!isOwner || saveBusy} onSelect={(file) => void handleAssetSelection("logo", file)} onClear={() => handleAssetClear("logo")} />
                <BrandAssetUploadField kind="icon" title="正方形应用图标" description="正方形 PNG 或 JPEG，尺寸 64×64 至 4096×4096，不超过 2 MB。" currentUrl={currentIconUrl} managedAsset={currentIconAsset} draft={iconDraft} clearPending={iconClearPending} disabled={!isOwner || saveBusy} onSelect={(file) => void handleAssetSelection("icon", file)} onClear={() => handleAssetClear("icon")} />
              </div>
            </DenCard>

            <div className="flex items-center justify-between gap-3">
              <p className="text-[13px] text-gray-500">{!isOwner ? "只有公司所有者可以修改品牌外观。" : null}</p>
              {isOwner ? <DenButton type="submit" loading={saveBusy}>保存品牌外观</DenButton> : null}
            </div>
          </form>
        )}
      </DashboardPageTemplate>
    </div>
  );
}
