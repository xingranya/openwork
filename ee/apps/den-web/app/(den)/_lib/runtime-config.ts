export type DenOrgMode = "single_org" | "multi_org";

export type DenWebRuntimeConfig = {
  openworkAppConnectUrl: string;
  openworkAuthCallbackUrl: string;
  foxworkMcpEndpoint: string;
  foxworkMcpDocsUrl: string;
  orgMode: DenOrgMode;
  singleOrgName: string;
  singleOrgSlug: string;
  singleOrgAllowPublicSignup: boolean;
  singleOrgSsoConfigured: boolean;
  emailRecoveryEnabled: boolean;
};

export const EMPTY_RUNTIME_CONFIG: DenWebRuntimeConfig = {
  openworkAppConnectUrl: "",
  openworkAuthCallbackUrl: "",
  foxworkMcpEndpoint: "",
  foxworkMcpDocsUrl: "",
  orgMode: "single_org",
  singleOrgName: "FoxWork 公司",
  singleOrgSlug: "default",
  singleOrgAllowPublicSignup: true,
  singleOrgSsoConfigured: false,
  emailRecoveryEnabled: false
};

let runtimeConfigPromise: Promise<DenWebRuntimeConfig> | null = null;

function normalizeOrgMode(value: unknown): DenOrgMode {
  return value === "multi_org" ? "multi_org" : "single_org";
}

function readStringProperty(value: object, key: string) {
  const property = Object.getOwnPropertyDescriptor(value, key)?.value;
  return typeof property === "string" ? property.trim() : "";
}

function readBooleanProperty(value: object, key: string) {
  return Object.getOwnPropertyDescriptor(value, key)?.value === true;
}

function normalizeRuntimeConfig(value: unknown): DenWebRuntimeConfig {
  if (typeof value !== "object" || value === null) {
    return EMPTY_RUNTIME_CONFIG;
  }

  const singleOrgName = readStringProperty(value, "singleOrgName");
  const singleOrgSlug = readStringProperty(value, "singleOrgSlug");
  return {
    openworkAppConnectUrl: readStringProperty(value, "openworkAppConnectUrl"),
    openworkAuthCallbackUrl: readStringProperty(value, "openworkAuthCallbackUrl"),
    foxworkMcpEndpoint: readStringProperty(value, "foxworkMcpEndpoint"),
    foxworkMcpDocsUrl: readStringProperty(value, "foxworkMcpDocsUrl"),
    orgMode: normalizeOrgMode(readStringProperty(value, "orgMode")),
    singleOrgName: singleOrgName || "FoxWork 公司",
    singleOrgSlug: singleOrgSlug || "default",
    singleOrgAllowPublicSignup: readBooleanProperty(value, "singleOrgAllowPublicSignup"),
    singleOrgSsoConfigured: readBooleanProperty(value, "singleOrgSsoConfigured"),
    emailRecoveryEnabled: readBooleanProperty(value, "emailRecoveryEnabled")
  };
}

export function getRuntimeConfig(): Promise<DenWebRuntimeConfig> {
  if (!runtimeConfigPromise) {
    runtimeConfigPromise = fetch("/api/runtime-config", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) {
          runtimeConfigPromise = null;
          return EMPTY_RUNTIME_CONFIG;
        }

        return normalizeRuntimeConfig(await response.json());
      })
      .catch(() => {
        runtimeConfigPromise = null;
        return EMPTY_RUNTIME_CONFIG;
      });
  }

  return runtimeConfigPromise;
}
