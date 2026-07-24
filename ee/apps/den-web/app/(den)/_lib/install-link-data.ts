import { getErrorMessage, requestJson } from "./den-flow";

function getInstallPageUrl(payload: unknown) {
  if (!payload || typeof payload !== "object" || !("installPageUrl" in payload)) {
    return null;
  }

  const installPageUrl = payload.installPageUrl;
  return typeof installPageUrl === "string" && installPageUrl.trim()
    ? installPageUrl.trim()
    : null;
}

export async function createOrganizationInstallLink(organizationId: string, rotate = false) {
  const { response, payload } = await requestJson(
    `/v1/orgs/${encodeURIComponent(organizationId)}/install-links`,
    { method: "POST", body: JSON.stringify({ rotate }) },
    12000,
  );

  if (!response.ok) {
    throw new Error(getErrorMessage(payload, `无法创建安装链接（${response.status}）。`));
  }

  const installPageUrl = getInstallPageUrl(payload);
  if (!installPageUrl) {
    throw new Error("安装链接返回的信息不完整。");
  }

  return installPageUrl;
}
