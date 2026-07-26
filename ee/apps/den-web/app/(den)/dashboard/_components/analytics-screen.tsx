"use client";

import { useMemo, useState } from "react";
import { Activity, CheckCircle2, ChevronRight, Clock, Users, Zap } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { requestJson } from "../../_lib/den-flow";
import { DenSelect } from "../../_components/ui/select";
import { useOrgDashboard } from "../_providers/org-dashboard-provider";
import { EnterprisePlanNotice } from "./enterprise-plan-notice";

/* 类型 */

type AnalyticsWeek = {
  weekStart: string;
  activeMembers: number;
  sessions: number;
  tasksCompleted: number;
  tasksFailed: number;
};

type AnalyticsData = {
  members: number;
  pendingInvites: number;
  activeMembers7d: number;
  activeMembers30d: number;
  sessions7d: number;
  sessions30d: number;
  tasksCompleted7d: number;
  tasksFailed7d: number;
  tasksCompleted30d: number;
  tasksFailed30d: number;
  avgTaskDurationMs30d: number | null;
  weekly: AnalyticsWeek[];
};

type DimensionOption = {
  type: string;
  value: string;
  label: string;
  sessionCount: number;
  lastSeenAt: string;
};

const PROJECT_DIMENSION_TYPE = "project";

/* 数据读取 */

function readNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function readObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value));
}

function readWeek(value: unknown): AnalyticsWeek {
  const w = readObject(value);
  return {
    weekStart: typeof w.weekStart === "string" ? w.weekStart : "",
    activeMembers: readNumber(w.activeMembers),
    sessions: readNumber(w.sessions),
    tasksCompleted: readNumber(w.tasksCompleted),
    tasksFailed: readNumber(w.tasksFailed),
  };
}

function readDimensionOption(value: unknown): DimensionOption | null {
  const item = readObject(value);
  const type = typeof item.type === "string" ? item.type : "";
  const dimensionValue = typeof item.value === "string" ? item.value : "";
  const label = typeof item.label === "string" ? item.label : "";
  if (!type || !dimensionValue || !label) return null;
  return {
    type,
    value: dimensionValue,
    label,
    sessionCount: readNumber(item.sessionCount),
    lastSeenAt: typeof item.lastSeenAt === "string" ? item.lastSeenAt : "",
  };
}

async function fetchDimensions(type: string): Promise<DimensionOption[]> {
  try {
    const params = new URLSearchParams({ type });
    const { response, payload } = await requestJson(`/v1/telemetry/dimensions?${params.toString()}`, { method: "GET" }, 12000);
    if (!response.ok) return [];
    const items = readObject(payload).items;
    if (!Array.isArray(items)) return [];
    return items.flatMap((item) => {
      const option = readDimensionOption(item);
      return option ? [option] : [];
    });
  } catch {
    return [];
  }
}

async function fetchAnalytics(dimensionValue: string): Promise<AnalyticsData | null> {
  try {
    const params = dimensionValue
      ? new URLSearchParams({ dimensionType: PROJECT_DIMENSION_TYPE, dimensionValue })
      : null;
    const path = params ? `/v1/telemetry/analytics?${params.toString()}` : "/v1/telemetry/analytics";
    const { response, payload } = await requestJson(path, { method: "GET" }, 12000);
    if (!response.ok || !payload || typeof payload !== "object") return null;
    const p = readObject(payload);
    return {
      members: readNumber(p.members),
      pendingInvites: readNumber(p.pendingInvites),
      activeMembers7d: readNumber(p.activeMembers7d),
      activeMembers30d: readNumber(p.activeMembers30d),
      sessions7d: readNumber(p.sessions7d),
      sessions30d: readNumber(p.sessions30d),
      tasksCompleted7d: readNumber(p.tasksCompleted7d),
      tasksFailed7d: readNumber(p.tasksFailed7d),
      tasksCompleted30d: readNumber(p.tasksCompleted30d),
      tasksFailed30d: readNumber(p.tasksFailed30d),
      avgTaskDurationMs30d: typeof p.avgTaskDurationMs30d === "number" ? p.avgTaskDurationMs30d : null,
      weekly: Array.isArray(p.weekly) ? p.weekly.map(readWeek) : [],
    };
  } catch {
    return null;
  }
}

function sortProjectOptions(options: DimensionOption[]): DimensionOption[] {
  return [...options].sort((left, right) => {
    const timeDelta = Date.parse(right.lastSeenAt) - Date.parse(left.lastSeenAt);
    return timeDelta || left.label.localeCompare(right.label);
  });
}

/* 格式化方法 */

function formatDuration(ms: number | null): string {
  if (ms === null) return "—";
  if (ms < 1000) return "<1 秒";
  const totalSeconds = Math.round(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds} 秒`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) return seconds > 0 ? `${minutes} 分 ${seconds} 秒` : `${minutes} 分`;
  const hours = Math.floor(minutes / 60);
  return `${hours} 小时 ${minutes % 60} 分`;
}

export function formatWeekLabel(weekStart: string): string {
  const date = new Date(`${weekStart}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return weekStart;
  return date.toLocaleDateString("zh-CN", { month: "short", day: "numeric", timeZone: "UTC" });
}

export function formatTrendPointTitle(weekStart: string, label: string, value: number): string {
  return `${formatWeekLabel(weekStart)}当周 · ${label}：${value}`;
}

function successRate(completed: number, failed: number): string {
  const total = completed + failed;
  if (total === 0) return "—";
  return `${Math.round((completed / total) * 100)}%`;
}

function toneBg(tone: "violet" | "green" | "blue" | "amber") {
  switch (tone) {
    case "violet": return "bg-[#EDE4FF]";
    case "green": return "bg-[#E3F3E3]";
    case "blue": return "bg-[#E4ECFB]";
    case "amber": return "bg-[#FBF0DC]";
  }
}

/* 页面组件 */

function StatCard({ icon, title, value, sub, tone }: {
  icon: React.ReactNode; title: string; value: string; sub?: string; tone: "violet" | "green" | "blue" | "amber";
}) {
  return (
    <div className="rounded-[16px] border border-[#e3e7ee] bg-white/90 px-4 py-3.5">
      <div className="flex items-center gap-3">
        <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-[12px] ${toneBg(tone)}`}>{icon}</div>
        <div className="min-w-0">
          <div className="text-[13px] font-medium tracking-[-0.01em] text-[#30405F]">{title}</div>
          <div className="mt-0.5 text-[20px] font-semibold tracking-[-0.03em] text-[#07192C]">{value}</div>
          {sub ? <div className="mt-0.5 truncate text-[12px] text-[#637291]">{sub}</div> : null}
        </div>
      </div>
    </div>
  );
}

type BarSeries = {
  label: string;
  color: string;
  values: number[];
};

function TrendChart({ title, subtitle, weeks, series }: {
  title: string;
  subtitle: string;
  weeks: AnalyticsWeek[];
  series: BarSeries[];
}) {
  const max = Math.max(1, ...series.flatMap((s) => s.values));
  const hasData = series.some((s) => s.values.some((v) => v > 0));

  return (
    <div className="rounded-[16px] border border-[#e3e7ee] bg-white/90 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h3 className="text-[14px] font-semibold tracking-[-0.01em] text-[#07192C]">{title}</h3>
          <p className="mt-0.5 text-[12px] text-[#637291]">{subtitle}</p>
        </div>
        {series.length > 1 ? (
          <div className="flex items-center gap-3">
            {series.map((s) => (
              <span key={s.label} className="flex items-center gap-1.5 text-[11px] text-[#637291]">
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: s.color }} />
                {s.label}
              </span>
            ))}
          </div>
        ) : null}
      </div>

      <div className="relative mt-4">
        <div className="flex h-[120px] items-end gap-1.5">
          {weeks.map((week, i) => (
            <div key={week.weekStart || i} className="flex h-full flex-1 items-end justify-center gap-px">
              {series.map((s) => {
                const value = s.values[i] ?? 0;
                const height = value > 0 ? Math.max(4, (value / max) * 100) : 2;
                return (
                  <div
                    key={s.label}
                    title={formatTrendPointTitle(week.weekStart, s.label, value)}
                    className="w-full max-w-[18px] rounded-t-[3px] transition-[height]"
                    style={{
                      height: `${height}%`,
                      backgroundColor: value > 0 ? s.color : "#EBEEF4",
                    }}
                  />
                );
              })}
            </div>
          ))}
        </div>
        {!hasData ? (
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="rounded-full bg-white/90 px-3 py-1 text-[12px] text-[#637291]">暂无用量事件</span>
          </div>
        ) : null}
      </div>

      <div className="mt-2 flex justify-between text-[11px] text-[#9AA5BA]">
        <span>{weeks.length > 0 ? formatWeekLabel(weeks[0].weekStart) : ""}</span>
        <span>{weeks.length > 0 ? formatWeekLabel(weeks[weeks.length - 1].weekStart) : ""}</span>
      </div>
    </div>
  );
}

/* 分析页面 */

export function AnalyticsScreen() {
  const { activeOrg, orgContext } = useOrgDashboard();
  const [selectedProjectValue, setSelectedProjectValue] = useState("");

  // 服务端会在分析接口上用 402 执行同一授权门，行为与 SSO 和桌面策略页一致。
  const locked = Boolean(orgContext) && !orgContext?.entitlements.analytics;

  const { data: rawProjectOptions = [] } = useQuery({
    queryKey: ["telemetry", "dimensions", PROJECT_DIMENSION_TYPE],
    queryFn: () => fetchDimensions(PROJECT_DIMENSION_TYPE),
    enabled: !locked,
  });

  const projectOptions = useMemo(
    () => sortProjectOptions(rawProjectOptions),
    [rawProjectOptions],
  );

  const selectedProject = useMemo(
    () => projectOptions.find((option) => option.value === selectedProjectValue) ?? null,
    [projectOptions, selectedProjectValue],
  );

  const { data, isLoading } = useQuery({
    queryKey: ["telemetry", "analytics", PROJECT_DIMENSION_TYPE, selectedProjectValue || "all"],
    queryFn: () => fetchAnalytics(selectedProjectValue),
    enabled: !locked,
  });

  const weekly = data?.weekly ?? [];
  const tasks7d = (data?.tasksCompleted7d ?? 0) + (data?.tasksFailed7d ?? 0);
  const isProjectFiltered = Boolean(selectedProjectValue);

  return (
    <div className="mx-auto max-w-[1100px] px-4 pb-8 pt-4 sm:px-6 md:px-8">

      {/* 面包屑 */}
      <div className="flex flex-wrap items-center gap-2.5 border-b border-[#e7e9f0] pb-3">
        <span className="text-[14px] font-semibold tracking-[-0.01em] text-[#07192C]">{activeOrg?.name ?? "FoxWork"}</span>
        <ChevronRight className="h-3.5 w-3.5 text-[#9AA5BA]" />
        <span className="text-[14px] font-medium tracking-[-0.01em] text-[#5A6886]">用量分析</span>
      </div>

      {/* 页面标题 */}
      <div className="mt-4 flex flex-wrap items-center gap-2.5">
        <h1 className="text-[22px] font-semibold tracking-[-0.03em] text-[#07192C]">使用情况</h1>
        <span className="rounded-full border border-[#d8e0ec] bg-white px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-[#6F3DFF]">
          企业版
        </span>
      </div>
      <p className="mt-1 text-[14px] leading-6 text-[#5A6886]">
        查看团队的活跃成员、会话和任务变化。这里只采集事件元数据，不采集提示词、代码或文件内容。
      </p>

      {!locked ? (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <label className="text-[12px] font-semibold uppercase text-[#637291]" htmlFor="analytics-project-filter">
            项目
          </label>
          <DenSelect
            id="analytics-project-filter"
            value={selectedProjectValue}
            onChange={(event) => setSelectedProjectValue(event.target.value)}
            aria-label="按项目筛选用量分析"
            className="h-9 min-w-[240px]"
          >
            <option value="">全部项目</option>
            {projectOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </DenSelect>
          {selectedProject ? (
            <span className="text-[12px] text-[#637291]">
              {selectedProject.sessionCount} 个会话
            </span>
          ) : null}
        </div>
      ) : null}

      {locked ? (
        <div className="mt-5">
          <EnterprisePlanNotice feature="用量分析" />
        </div>
      ) : (
      <>
      {/* 汇总数据 */}
      <div className="mt-5 grid gap-3.5 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          icon={<Users className="h-5 w-5 text-[#6F3DFF]" />}
          title="FoxWork 用户"
          value={isLoading ? "…" : `${data?.members ?? 0}`}
          sub={isProjectFiltered ? "公司总数，不受项目筛选影响" : `${data?.pendingInvites ?? 0} 个待处理邀请`}
          tone="violet"
        />
        <StatCard
          icon={<Activity className="h-5 w-5 text-[#1D63FF]" />}
          title="本周活跃成员"
          value={isLoading ? "…" : `${data?.activeMembers7d ?? 0}`}
          sub={`近 30 天活跃 ${data?.activeMembers30d ?? 0} 人`}
          tone="blue"
        />
        <StatCard
          icon={<Zap className="h-5 w-5 text-[#B7791F]" />}
          title="本周会话"
          value={isLoading ? "…" : `${data?.sessions7d ?? 0}`}
          sub={`近 30 天 ${data?.sessions30d ?? 0} 个`}
          tone="amber"
        />
        <StatCard
          icon={<CheckCircle2 className="h-5 w-5 text-[#18A34A]" />}
          title="本周任务"
          value={isLoading ? "…" : `${tasks7d}`}
          sub={`成功率 ${successRate(data?.tasksCompleted7d ?? 0, data?.tasksFailed7d ?? 0)}`}
          tone="green"
        />
      </div>

      {/* 趋势图 */}
      <div className="mt-4 grid gap-3.5 lg:grid-cols-2">
        <TrendChart
          title="每周活跃成员"
          subtitle={isProjectFiltered ? "近 12 周内有此项目事件的成员" : "近 12 周内至少产生一次事件的成员"}
          weeks={weekly}
          series={[{ label: "活跃成员", color: "#6F3DFF", values: weekly.map((w) => w.activeMembers) }]}
        />
        <TrendChart
          title="每周会话"
          subtitle="近 12 周的独立会话"
          weeks={weekly}
          series={[{ label: "会话", color: "#1D63FF", values: weekly.map((w) => w.sessions) }]}
        />
      </div>

      <div className="mt-3.5">
        <TrendChart
          title="每周任务"
          subtitle="近 12 周已完成和失败的任务运行"
          weeks={weekly}
          series={[
            { label: "已完成", color: "#18A34A", values: weekly.map((w) => w.tasksCompleted) },
            { label: "失败", color: "#E5484D", values: weekly.map((w) => w.tasksFailed) },
          ]}
        />
      </div>

      {/* 近 30 天数据 */}
      <div className="mt-4 grid gap-3.5 sm:grid-cols-3">
        <StatCard
          icon={<Clock className="h-5 w-5 text-[#1D63FF]" />}
          title="平均任务耗时"
          value={isLoading ? "…" : formatDuration(data?.avgTaskDurationMs30d ?? null)}
          sub="近 30 天完成的任务"
          tone="blue"
        />
        <StatCard
          icon={<CheckCircle2 className="h-5 w-5 text-[#18A34A]" />}
          title="已完成任务"
          value={isLoading ? "…" : `${data?.tasksCompleted30d ?? 0}`}
          sub="近 30 天"
          tone="green"
        />
        <StatCard
          icon={<Activity className="h-5 w-5 text-[#E5484D]" />}
          title="失败任务"
          value={isLoading ? "…" : `${data?.tasksFailed30d ?? 0}`}
          sub={`近 30 天成功率 ${successRate(data?.tasksCompleted30d ?? 0, data?.tasksFailed30d ?? 0)}`}
          tone="amber"
        />
      </div>

      {/* 隐私说明 */}
      <p className="mt-5 text-[12px] leading-5 text-[#9AA5BA]">
        遥测不会包含提示词、代码、文件内容、差异、密钥或终端输出。成员登录 FoxWork 并运行任务后，用量数据会显示在这里。
      </p>
      </>
      )}
    </div>
  );
}
