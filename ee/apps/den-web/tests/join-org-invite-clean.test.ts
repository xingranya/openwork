import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "bun:test";
import { parseInvitationPreviewPayload } from "../app/(den)/_lib/den-org";

const joinOrgScreenPath = fileURLToPath(
  new URL("../app/(den)/_components/join-org-screen.tsx", import.meta.url),
);
const onboardingShellPath = fileURLToPath(
  new URL("../app/(den)/_components/onboarding-shell.tsx", import.meta.url),
);
const joinOrgSuccessPath = fileURLToPath(
  new URL("../app/(den)/_components/join-org-success.tsx", import.meta.url),
);
const installScreenPath = fileURLToPath(
  new URL("../app/(den)/_components/install-screen.tsx", import.meta.url),
);
const brandIdentityPath = fileURLToPath(
  new URL("../app/(den)/_components/organization-brand-identity.tsx", import.meta.url),
);

function readJoinOrgScreenSource() {
  return readFileSync(joinOrgScreenPath, "utf8");
}

function readOnboardingShellSource() {
  return readFileSync(onboardingShellPath, "utf8");
}

describe("join organization invite clean layout contract", () => {
  test("uses one light Dithering layer and no mesh gradient", () => {
    const source = readOnboardingShellSource();
    const ditheringImports = source.match(/import \{ Dithering \} from "@paper-design\/shaders-react"/g) ?? [];
    const ditheringUses = source.match(/<Dithering\b/g) ?? [];

    expect(ditheringImports).toHaveLength(1);
    expect(ditheringUses).toHaveLength(1);
    expect(source).not.toContain("PaperMeshGradient");
    expect(source).toContain("colorBack=\"#F8FBFF\"");
    expect(source).toContain("colorFront=\"#8FB7E8\"");
    expect(source).toContain('style={{ backgroundColor: "#F8FBFF", width: "100%", height: "100%" }}');
  });

  test("keeps the decorative background separate, restrained, and reduced-motion aware", () => {
    const source = readOnboardingShellSource();

    expect(source).toContain("min-h-dvh overflow-y-auto bg-[#f8fbff]");
    expect(source).toContain("pointer-events-none fixed inset-0 z-0 overflow-hidden bg-[#f8fbff] opacity-[0.09]");
    expect(source).toContain('aria-hidden="true"');
    expect(source).toContain('data-testid="join-org-background"');
    expect(source).toContain('data-testid="join-org-foreground"');
    expect(source).toContain("relative z-10");
    expect(source).toContain("useSyncExternalStore");
    expect(source).toContain('const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";');
    expect(source).toContain("function getReducedMotionServerSnapshot()");
    expect(source).toContain("const shaderSpeed = reducedMotion ? 0 : 0.012;");
    expect(source).toContain("speed={shaderSpeed}");
    expect(source).toContain('data-shader-speed={shaderSpeed}');
  });

  test("移除嵌套框架并保留紧凑的居中层级", () => {
    const source = readJoinOrgScreenSource();
    const shellSource = readOnboardingShellSource();

    expect(source).not.toContain("den-frame");
    expect(source).not.toContain("den-frame-inset");
    expect(shellSource).toContain('compact: "max-w-md"');
    expect(shellSource).toContain('data-testid="join-org-root"');
    expect(source).toContain('data-testid="join-org-invitation-details"');
    expect(source).toContain('data-testid="join-org-actions"');
    expect(source).toContain('data-testid="join-org-auth"');
    expect(source).toContain('<DetailRow label="公司">');
    expect(source).toContain('<DetailRow label="受邀邮箱">');
    expect(source).toContain('<DetailRow label="角色">');
    expect(source).toContain('<DetailRow label="当前账号">');
    expect(source).not.toMatch(/\binviter\b/i);
  });

  test("使用简洁邀请登录和不改变邀请状态的暂不处理操作", () => {
    const source = readJoinOrgScreenSource();

    expect(source).toMatch(/<AuthPanel[\s\S]*?\bbare\b/);
    expect(source).toMatch(/<AuthPanel[\s\S]*?\blockEmail\b/);
    expect(source).toMatch(/<AuthPanel[\s\S]*?\bhideEmailField\b/);
    expect(source).toMatch(/<AuthPanel[\s\S]*?\bhideLockedEmailSummary\b/);
    expect(source).toContain('title: "创建公司账号"');
    expect(source).toContain('title: "登录后继续"');
    expect(source).not.toContain("title: `Join ${preview.organization.name}.`");
    expect(source).toContain("暂不处理");
    expect(source).toContain("function handleNotNow()");
    expect(source).toContain("window.sessionStorage.removeItem(PENDING_ORG_INVITATION_STORAGE_KEY);");
    expect(source).toContain('router.replace("/");');
    expect(source).not.toContain("拒绝邀请");
    expect(source).not.toContain("取消邀请");
  });

  test("保留邀请预览、账号切换、状态和接受行为", () => {
    const source = readJoinOrgScreenSource();

    expect(source).toContain("/v1/orgs/invitations/preview?id=");
    expect(source).toContain("/v1/orgs/invitations/accept");
    expect(source).toContain("parseInvitationPreviewPayload(payload)");
    expect(source).toContain("isEmailAllowedForOrganization");
    expect(source).toContain("statusMessage(preview)");
    expect(source).toContain("handleSwitchAccount");
    expect(source).toContain("window.sessionStorage.setItem(PENDING_ORG_INVITATION_STORAGE_KEY, invitationId);");
    expect(source).toContain("请使用公司允许的邮箱");
    expect(source).toContain("这份邀请发给了");
    expect(source).toContain("切换账号");
    expect(source).toContain("退出登录");
    expect(source).toContain("加入 ${preview.organization.name}");
  });

  test("carries explicit organization branding through the invitation preview", () => {
    const preview = parseInvitationPreviewPayload({
      invitation: {
        id: "invitation_123",
        email: "teammate@example.com",
        role: "member",
        status: "pending",
      },
      organization: {
        id: "organization_123",
        name: "Blue Yonder",
        slug: "blue-yonder",
        allowedEmailDomains: ["example.com"],
        branding: {
          appName: "Agent Blue",
          logoUrl: "https://cdn.example.com/wordmark.png",
          iconUrl: "https://cdn.example.com/icon.png",
        },
      },
    });

    expect(preview?.organization.branding).toEqual({
      appName: "Agent Blue",
      logoUrl: "https://cdn.example.com/wordmark.png",
      iconUrl: "https://cdn.example.com/icon.png",
    });

    const legacyPreview = parseInvitationPreviewPayload({
      invitation: {
        id: "invitation_legacy",
        email: "teammate@example.com",
        role: "member",
        status: "pending",
      },
      organization: {
        id: "organization_legacy",
        name: "Blue Yonder",
        slug: "blue-yonder",
        allowedEmailDomains: null,
      },
    });

    expect(legacyPreview?.organization.branding).toEqual({
      appName: "SeeWayWork",
      logoUrl: null,
      iconUrl: null,
    });
  });

  test("加入公司后的中文引导保留桌面交接和分平台下载", () => {
    const successSource = readFileSync(joinOrgSuccessPath, "utf8");
    const installSource = readFileSync(installScreenPath, "utf8");
    const identitySource = readFileSync(brandIdentityPath, "utf8");

    expect(successSource).toContain("下载 SeeWayWork");
    expect(successSource).toContain("返回 SeeWayWork");
    expect(successSource).toContain("desktopAuthRequested");
    expect(successSource).toContain("在浏览器中继续");
    expect(successSource).toContain("capabilities");
    expect(successSource).not.toContain("Open OpenWork");
    expect(successSource).toContain("已加入");
    expect(installSource).toContain("DownloadPlatformGrid");
    expect(installSource).toContain("<span>下载 SeeWayWork</span>");
    expect(installSource).toContain("安装脚本（ARM64）");
    expect(identitySource).toContain("failedLogoUrl");
    expect(identitySource).toContain("failedIconUrl");
  });
});
