import { NextResponse } from "next/server";
import { joinBaseUrl, readBaseUrlEnv } from "@openwork/types/url";

export const dynamic = "force-dynamic";

function readPublicRuntimeEnv(name: string) {
  return process.env[name]?.trim() ?? "";
}

function readOrgMode() {
  return readPublicRuntimeEnv("DEN_ORG_MODE") === "multi_org" ? "multi_org" : "single_org";
}

function readBooleanEnv(name: string, defaultValue: boolean) {
  const normalized = readPublicRuntimeEnv(name).toLowerCase();
  if (!normalized) {
    return defaultValue;
  }

  if (["1", "true", "yes", "y", "on"].includes(normalized)) {
    return true;
  }

  if (["0", "false", "no", "n", "off"].includes(normalized)) {
    return false;
  }

  return defaultValue;
}

function normalizeBaseUrl(value: string) {
  return value.trim().replace(/\/+$/, "");
}

function readBaseUrlEnv(name: string) {
  const value = process.env[name]?.trim();
  return value ? normalizeBaseUrl(value) : "";
}

function readMcpEndpoint() {
  const explicitEndpoint = readBaseUrlEnv("DEN_WEB_FOXWORK_MCP_ENDPOINT");
  if (explicitEndpoint) return explicitEndpoint;

  const configured =
    readBaseUrlEnv("DEN_MCP_PUBLIC_URL") ||
    readBaseUrlEnv("DEN_MCP_RESOURCE_URL") ||
    readBaseUrlEnv("DEN_API_PUBLIC_URL");
  if (!configured) return "";

  try {
    const url = new URL(configured);
    const pathname = url.pathname.replace(/\/+$/, "");
    if (pathname.endsWith("/mcp/agent")) return url.toString().replace(/\/+$/, "");
    if (pathname.endsWith("/mcp")) {
      url.pathname = `${pathname}/agent`;
      return url.toString().replace(/\/+$/, "");
    }
    url.pathname = `${pathname}/mcp/agent`.replace(/\/+/g, "/");
    return url.toString().replace(/\/+$/, "");
  } catch {
    return "";
  }
}

function readBooleanProperty(value: object, key: string) {
  return Object.getOwnPropertyDescriptor(value, key)?.value === true;
}

async function readSingleOrgSsoConfigured(orgMode: string) {
  if (orgMode !== "single_org") {
    return false;
  }

  const apiBase = readBaseUrlEnv(process.env, "DEN_API_BASE") ?? "";
  if (!apiBase) {
    return false;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2_000);
  try {
    const response = await fetch(joinBaseUrl(apiBase, "v1/orgs/sso/singleton"), {
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) {
      return false;
    }

    const payload: unknown = await response.json();
    return typeof payload === "object" && payload !== null && readBooleanProperty(payload, "configured");
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

export async function GET() {
  const orgMode = readOrgMode();
  const singleOrgSsoConfigured = await readSingleOrgSsoConfigured(orgMode);

  return NextResponse.json(
    {
      openworkAppConnectUrl: readPublicRuntimeEnv("DEN_WEB_OPENWORK_APP_CONNECT_URL"),
      openworkAuthCallbackUrl: readPublicRuntimeEnv("DEN_WEB_OPENWORK_AUTH_CALLBACK_URL"),
      foxworkMcpEndpoint: readMcpEndpoint(),
      foxworkMcpDocsUrl: readPublicRuntimeEnv("DEN_WEB_FOXWORK_MCP_DOCS_URL"),
      orgMode,
      singleOrgName: readPublicRuntimeEnv("DEN_SINGLE_ORG_NAME") || "FoxWork 公司",
      singleOrgSlug: readPublicRuntimeEnv("DEN_SINGLE_ORG_SLUG") || "default",
      singleOrgAllowPublicSignup: readBooleanEnv("DEN_SINGLE_ORG_ALLOW_PUBLIC_SIGNUP", true),
      singleOrgSsoConfigured,
      emailRecoveryEnabled: readBooleanEnv("DEN_EMAIL_RECOVERY_ENABLED", orgMode === "multi_org")
    },
    {
      headers: {
        "Cache-Control": "no-store"
      }
    }
  );
}
