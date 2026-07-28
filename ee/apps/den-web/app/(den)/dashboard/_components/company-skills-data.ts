"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getRequestError, requestJson } from "../../_lib/den-flow";

export type CompanySkill = {
  bundleHash: string;
  description: string | null;
  fileCount: number;
  id: string;
  orgWide: boolean;
  slug: string;
  title: string;
  updatedAt: string | null;
};

export type CompanySkillImportAction = "created" | "updated" | "unchanged";

export type CompanySkillImportResult = {
  action: CompanySkillImportAction;
  bundleHash: string;
  fileCount: number;
  folder: string;
  id: string;
  pluginId: string;
  slug: string;
};

export type CompanySkillImportFailure = {
  code: string;
  folder: string;
  reason: string;
  slug: string | null;
};

export type CompanySkillImportSummary = {
  failures: CompanySkillImportFailure[];
  results: CompanySkillImportResult[];
};

export type CompanySkillImportInput = {
  archive: File;
  memberIds: string[];
  orgWide: boolean;
  overwrite: boolean;
  teamIds: string[];
};

export const companySkillQueryKeys = {
  all: ["company-skills"] as const,
  list: () => [...companySkillQueryKeys.all, "list"] as const,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function asNullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function asNonNegativeInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}

function uniqueIds(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function companySkillSlug(relativePath: unknown) {
  if (typeof relativePath !== "string") return null;
  const match = /^company-skills\/([a-z0-9](?:[a-z0-9_-]{0,62}[a-z0-9])?)\/SKILL\.md$/u.exec(relativePath);
  return match?.[1] ?? null;
}

export function parseCompanySkillsPayload(payload: unknown): CompanySkill[] {
  if (!isRecord(payload) || !Array.isArray(payload.items)) {
    return [];
  }

  return payload.items.flatMap((entry) => {
    if (!isRecord(entry)) return [];
    const id = asString(entry.id);
    const slug = companySkillSlug(entry.currentRelativePath);
    const title = asString(entry.title);
    const latestVersion = isRecord(entry.latestVersion) ? entry.latestVersion : null;
    const normalizedPayload = latestVersion && isRecord(latestVersion.normalizedPayloadJson)
      ? latestVersion.normalizedPayloadJson
      : null;
    const bundle = normalizedPayload && isRecord(normalizedPayload.foxworkSkillBundle)
      ? normalizedPayload.foxworkSkillBundle
      : null;
    const bundleHash = bundle ? asString(bundle.bundleHash) : null;
    const rawFiles = bundle?.files;
    const files = Array.isArray(rawFiles)
      ? rawFiles.flatMap((file) => {
          if (!isRecord(file) || typeof file.path !== "string" || typeof file.contents !== "string") return [];
          return [{ path: file.path, contents: file.contents }];
        })
      : [];
    const entrypoint = files.find((file) => file.path === "SKILL.md");
    if (
      entry.objectType !== "skill"
      || !id
      || !slug
      || !title
      || !bundleHash
      || bundle?.version !== 1
      || (bundle.shared !== "org" && bundle.shared !== "private")
      || !Array.isArray(rawFiles)
      || files.length !== rawFiles.length
      || !entrypoint
      || entrypoint.contents !== latestVersion?.rawSourceText
    ) {
      return [];
    }
    return [{
      bundleHash,
      description: asNullableString(entry.description),
      fileCount: files.length,
      id,
      orgWide: bundle.shared === "org",
      slug,
      title,
      updatedAt: asNullableString(entry.updatedAt),
    } satisfies CompanySkill];
  });
}

export function parseCompanySkillImportPayload(payload: unknown): CompanySkillImportSummary {
  const results = isRecord(payload) && Array.isArray(payload.results)
    ? payload.results.flatMap((entry) => {
        if (!isRecord(entry)) return [];
        const action = entry.action;
        const bundleHash = asString(entry.bundleHash);
        const fileCount = asNonNegativeInteger(entry.fileCount);
        const folder = asString(entry.folder);
        const id = asString(entry.id);
        const pluginId = asString(entry.pluginId);
        const slug = asString(entry.slug);
        if (
          (action !== "created" && action !== "updated" && action !== "unchanged")
          || !bundleHash
          || fileCount === null
          || !folder
          || !id
          || !pluginId
          || !slug
        ) {
          return [];
        }
        return [{ action, bundleHash, fileCount, folder, id, pluginId, slug } satisfies CompanySkillImportResult];
      })
    : [];

  const failures = isRecord(payload) && Array.isArray(payload.failures)
    ? payload.failures.flatMap((entry) => {
        if (!isRecord(entry)) return [];
        const code = asString(entry.code);
        const folder = asString(entry.folder);
        const reason = asString(entry.reason);
        if (!code || !folder || !reason) return [];
        return [{
          code,
          folder,
          reason,
          slug: asString(entry.slug),
        } satisfies CompanySkillImportFailure];
      })
    : [];

  return { failures, results };
}

export function formatCompanySkillImportAction(action: CompanySkillImportAction) {
  if (action === "created") return "已新建";
  if (action === "updated") return "已更新";
  return "未变化";
}

export function buildCompanySkillImportForm(input: CompanySkillImportInput) {
  const form = new FormData();
  form.set("archive", input.archive);
  form.set("orgWide", String(input.orgWide));
  form.set("overwrite", String(input.overwrite));
  form.set("memberIds", JSON.stringify(uniqueIds(input.memberIds)));
  form.set("teamIds", JSON.stringify(uniqueIds(input.teamIds)));
  return form;
}

export function useCompanySkills() {
  return useQuery({
    queryKey: companySkillQueryKeys.list(),
    queryFn: async () => {
      const { response, payload } = await requestJson(
        "/v1/config-objects?type=skill&status=active&limit=100",
        { method: "GET" },
        15000,
      );
      if (!response.ok) {
        throw getRequestError(payload, response, `加载公司技能失败（${response.status}）。`);
      }
      if (!isRecord(payload) || !Array.isArray(payload.items)) {
        throw new Error("公司服务返回的技能列表格式不完整，请刷新后重试。");
      }
      return parseCompanySkillsPayload(payload);
    },
  });
}

export function useImportCompanySkills() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: CompanySkillImportInput) => {
      const { response, payload } = await requestJson(
        "/v1/plugins/import-skills-zip",
        { method: "POST", body: buildCompanySkillImportForm(input) },
        60000,
      );
      if (!response.ok) {
        throw getRequestError(payload, response, `导入公司技能失败（${response.status}）。`);
      }
      if (!isRecord(payload) || !Array.isArray(payload.results) || !Array.isArray(payload.failures)) {
        throw new Error("公司服务返回的导入结果不完整，请刷新技能列表确认。");
      }
      return parseCompanySkillImportPayload(payload);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: companySkillQueryKeys.all });
    },
  });
}
