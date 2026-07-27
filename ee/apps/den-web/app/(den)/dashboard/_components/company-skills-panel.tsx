"use client";

import { useState } from "react";
import {
  CheckCircle2,
  FileArchive,
  RefreshCw,
  Upload,
  Users,
  XCircle,
} from "lucide-react";
import { splitRoleString } from "../../_lib/den-org";
import { getErrorMessage } from "../../_lib/den-flow";
import { useOrgDashboard } from "../_providers/org-dashboard-provider";
import { DenButton } from "../../_components/ui/button";
import { DenCard } from "../../_components/ui/card";
import { DenNotice } from "../../_components/ui/notice";
import {
  formatCompanySkillImportAction,
  useCompanySkills,
  useImportCompanySkills,
  type CompanySkillImportSummary,
} from "./company-skills-data";

const MAX_SKILL_ZIP_BYTES = 12 * 1024 * 1024;

function formatUpdatedAt(value: string | null) {
  if (!value) return "更新时间未知";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "更新时间未知";
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function toggleId(current: string[], id: string) {
  return current.includes(id)
    ? current.filter((value) => value !== id)
    : [...current, id];
}

export function CompanySkillsPanel() {
  const { orgContext, runReauthableAction } = useOrgDashboard();
  const skillsQuery = useCompanySkills();
  const importMutation = useImportCompanySkills();
  const [archive, setArchive] = useState<File | null>(null);
  const [orgWide, setOrgWide] = useState(true);
  const [overwrite, setOverwrite] = useState(false);
  const [memberIds, setMemberIds] = useState<string[]>([]);
  const [teamIds, setTeamIds] = useState<string[]>([]);
  const [pageError, setPageError] = useState<string | null>(null);
  const [summary, setSummary] = useState<CompanySkillImportSummary | null>(null);

  const canManage = orgContext?.currentMember.isOwner === true
    || splitRoleString(orgContext?.currentMember.role ?? "member").includes("admin");
  const members = orgContext?.members ?? [];
  const teams = orgContext?.teams ?? [];
  const accessReady = orgWide || memberIds.length > 0 || teamIds.length > 0;

  function handleArchiveChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    setPageError(null);
    setSummary(null);
    if (!file) {
      setArchive(null);
      return;
    }
    if (!file.name.toLowerCase().endsWith(".zip")) {
      setArchive(null);
      setPageError("请选择 ZIP 格式的技能压缩包。");
      event.target.value = "";
      return;
    }
    if (file.size > MAX_SKILL_ZIP_BYTES) {
      setArchive(null);
      setPageError("ZIP 文件不能超过 12 MB。");
      event.target.value = "";
      return;
    }
    setArchive(file);
  }

  async function handleImport(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPageError(null);
    setSummary(null);
    if (!archive) {
      setPageError("请先选择要导入的 ZIP 文件。");
      return;
    }
    if (!accessReady) {
      setPageError("请选择全公司成员，或至少指定一名成员或一个团队。");
      return;
    }

    try {
      await runReauthableAction("import-company-skills", async () => {
        const result = await importMutation.mutateAsync({
          archive,
          memberIds,
          orgWide,
          overwrite,
          teamIds,
        });
        setSummary(result);
      });
    } catch (error) {
      setPageError(getErrorMessage(error, "导入公司技能失败，请重试。"));
    }
  }

  return (
    <div className="mb-8 grid gap-5">
      {canManage ? (
        <DenCard size="spacious">
          <form className="grid gap-6" onSubmit={handleImport}>
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <div className="flex items-center gap-2 text-violet-700">
                  <FileArchive className="size-5" aria-hidden />
                  <h2 className="text-[20px] font-semibold tracking-[-0.03em]">批量导入公司技能</h2>
                </div>
                <p className="mt-2 max-w-[720px] text-[14px] leading-7 text-gray-500">
                  上传一个 ZIP，每个一级文件夹代表一个技能。系统会检查 SKILL.md、名称、目录和文件安全，并逐项显示结果。
                </p>
              </div>
              <label className="inline-flex h-10 cursor-pointer items-center justify-center gap-2 rounded-lg border border-gray-200 bg-white px-5 text-[13px] font-medium text-gray-700 transition hover:border-gray-300 hover:bg-gray-50">
                <Upload className="size-4" aria-hidden />
                选择 ZIP 文件
                <input
                  className="sr-only"
                  type="file"
                  accept=".zip,application/zip"
                  onChange={handleArchiveChange}
                />
              </label>
            </div>

            {archive ? (
              <div className="flex items-center justify-between gap-4 rounded-2xl border border-violet-100 bg-violet-50 px-4 py-3 text-[13px] text-violet-900">
                <span className="min-w-0 truncate">已选择：{archive.name}</span>
                <span className="shrink-0 text-violet-600">{(archive.size / 1024).toFixed(1)} KB</span>
              </div>
            ) : null}

            <fieldset className="grid gap-3">
              <legend className="text-[14px] font-medium text-gray-800">分发范围</legend>
              <div className="grid gap-3 md:grid-cols-2">
                <label className={`flex cursor-pointer items-start gap-3 rounded-2xl border p-4 ${orgWide ? "border-violet-300 bg-violet-50" : "border-gray-200 bg-white"}`}>
                  <input
                    type="radio"
                    name="company-skill-access"
                    checked={orgWide}
                    onChange={() => setOrgWide(true)}
                  />
                  <span>
                    <span className="block text-[14px] font-medium text-gray-900">全公司成员</span>
                    <span className="mt-1 block text-[12px] leading-5 text-gray-500">当前成员和以后加入公司的成员都可以获得这些技能。</span>
                  </span>
                </label>
                <label className={`flex cursor-pointer items-start gap-3 rounded-2xl border p-4 ${!orgWide ? "border-violet-300 bg-violet-50" : "border-gray-200 bg-white"}`}>
                  <input
                    type="radio"
                    name="company-skill-access"
                    checked={!orgWide}
                    onChange={() => setOrgWide(false)}
                  />
                  <span>
                    <span className="block text-[14px] font-medium text-gray-900">指定成员或团队</span>
                    <span className="mt-1 block text-[12px] leading-5 text-gray-500">只向勾选的员工和团队下发，导入管理员仍保留管理权限。</span>
                  </span>
                </label>
              </div>
            </fieldset>

            {!orgWide ? (
              <div className="grid gap-4 lg:grid-cols-2">
                <AccessList
                  title="成员"
                  emptyLabel="公司内还没有可选成员。"
                  items={members.map((member) => ({ id: member.id, label: member.user.name || member.user.email }))}
                  selectedIds={memberIds}
                  onToggle={(id) => setMemberIds((current) => toggleId(current, id))}
                />
                <AccessList
                  title="团队"
                  emptyLabel="公司内还没有可选团队。"
                  items={teams.map((team) => ({ id: team.id, label: team.name }))}
                  selectedIds={teamIds}
                  onToggle={(id) => setTeamIds((current) => toggleId(current, id))}
                />
              </div>
            ) : null}

            <label className="flex items-start gap-3 rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3">
              <input
                className="mt-0.5"
                type="checkbox"
                checked={overwrite}
                onChange={(event) => setOverwrite(event.target.checked)}
              />
              <span>
                <span className="block text-[14px] font-medium text-gray-900">覆盖同名技能</span>
                <span className="mt-1 block text-[12px] leading-5 text-gray-500">关闭时，同名但内容不同的技能会失败；内容完全相同会显示“未变化”。</span>
              </span>
            </label>

            {pageError ? <DenNotice message={pageError} /> : null}

            <div className="flex justify-end">
              <DenButton
                type="submit"
                icon={Upload}
                loading={importMutation.isPending}
                disabled={!archive || !accessReady}
              >
                开始导入
              </DenButton>
            </div>
          </form>
        </DenCard>
      ) : null}

      {summary ? <ImportSummary summary={summary} /> : null}

      <DenCard size="spacious">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <Users className="size-5 text-slate-600" aria-hidden />
              <h2 className="text-[20px] font-semibold tracking-[-0.03em] text-gray-900">公司技能</h2>
            </div>
            <p className="mt-2 text-[14px] text-gray-500">这里显示当前账号有权使用的公司技能和文件数量。</p>
          </div>
          <DenButton
            variant="secondary"
            size="sm"
            icon={RefreshCw}
            loading={skillsQuery.isFetching}
            onClick={() => void skillsQuery.refetch()}
          >
            刷新
          </DenButton>
        </div>

        {skillsQuery.error ? (
          <DenNotice
            className="mt-5"
            message={getErrorMessage(skillsQuery.error, "加载公司技能失败，请重试。")}
          />
        ) : skillsQuery.isLoading ? (
          <p className="mt-6 text-[14px] text-gray-500">正在加载公司技能...</p>
        ) : (skillsQuery.data ?? []).length === 0 ? (
          <div className="mt-6 rounded-2xl border border-dashed border-gray-200 px-5 py-8 text-center text-[14px] text-gray-500">
            当前账号还没有可用的公司技能。
          </div>
        ) : (
          <div className="mt-6 grid gap-3 md:grid-cols-2">
            {(skillsQuery.data ?? []).map((skill) => (
              <div key={skill.id} className="rounded-2xl border border-gray-200 px-5 py-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-[14px] font-semibold text-gray-900">{skill.title}</p>
                    <p className="mt-1 line-clamp-2 text-[12px] leading-5 text-gray-500">
                      {skill.description || "没有填写技能说明。"}
                    </p>
                  </div>
                  <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] ${skill.orgWide ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>
                    {skill.orgWide ? "全公司" : "指定范围"}
                  </span>
                </div>
                <p className="mt-3 text-[11px] text-gray-400">
                  {skill.fileCount} 个文件 · {formatUpdatedAt(skill.updatedAt)}
                </p>
              </div>
            ))}
          </div>
        )}
      </DenCard>
    </div>
  );
}

function AccessList({
  emptyLabel,
  items,
  onToggle,
  selectedIds,
  title,
}: {
  emptyLabel: string;
  items: Array<{ id: string; label: string }>;
  onToggle: (id: string) => void;
  selectedIds: string[];
  title: string;
}) {
  return (
    <fieldset className="rounded-2xl border border-gray-200 p-4">
      <legend className="px-2 text-[13px] font-medium text-gray-700">{title}</legend>
      {items.length === 0 ? (
        <p className="text-[12px] text-gray-400">{emptyLabel}</p>
      ) : (
        <div className="grid max-h-48 gap-2 overflow-y-auto pr-1">
          {items.map((item) => (
            <label key={item.id} className="flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2 hover:bg-gray-50">
              <input
                type="checkbox"
                checked={selectedIds.includes(item.id)}
                onChange={() => onToggle(item.id)}
              />
              <span className="min-w-0 truncate text-[13px] text-gray-700">{item.label}</span>
            </label>
          ))}
        </div>
      )}
    </fieldset>
  );
}

function ImportSummary({ summary }: { summary: CompanySkillImportSummary }) {
  return (
    <DenCard size="spacious">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-[20px] font-semibold tracking-[-0.03em] text-gray-900">导入结果</h2>
          <p className="mt-2 text-[14px] text-gray-500">
            成功处理 {summary.results.length} 个，失败 {summary.failures.length} 个。失败项不会静默跳过。
          </p>
        </div>
      </div>

      <div className="mt-5 grid gap-3">
        {summary.results.map((result) => (
          <div key={`${result.folder}:${result.slug}`} className="flex items-start gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3">
            <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" aria-hidden />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium text-emerald-900">{result.slug}</span>
                <span className="rounded-full bg-white/80 px-2 py-0.5 text-[11px] text-emerald-700">
                  {formatCompanySkillImportAction(result.action)}
                </span>
              </div>
              <p className="mt-1 text-[12px] text-emerald-700">目录：{result.folder} · {result.fileCount} 个文件</p>
            </div>
          </div>
        ))}
        {summary.failures.map((failure, index) => (
          <div key={`${failure.folder}:${failure.code}:${index}`} className="flex items-start gap-3 rounded-2xl border border-red-200 bg-red-50 px-4 py-3">
            <XCircle className="mt-0.5 size-4 shrink-0 text-red-600" aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="font-medium text-red-900">{failure.slug || failure.folder}</p>
              <p className="mt-1 text-[12px] leading-5 text-red-700">失败原因：{failure.reason}</p>
            </div>
          </div>
        ))}
      </div>
    </DenCard>
  );
}
