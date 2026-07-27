/** @jsxImportSource react */
import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  type KeyboardEvent as ReactKeyboardEvent,
  type SetStateAction,
} from "react";
import {
  Cloud,
  Edit2,
  FolderOpen,
  Loader2,
  Package,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  SquareArrowOutUpRight,
  Sparkles,
  Trash2,
  Upload,
  Users,
} from "lucide-react";
import { toast } from "@/components/ui/sonner";

import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { t } from "@/i18n";
import { saveInstalledSkillToOpenWorkOrg } from "@/app/lib/den-skills";
import { toChineseUserMessage } from "@/app/lib/user-facing-error";
import {
  buildDenAuthUrl,
  DEFAULT_DEN_BASE_URL,
  readDenSettings,
} from "@/app/lib/den";
import type {
  DenOrgSkillCard,
  HubSkillCard,
  HubSkillRepo,
  SkillCard,
} from "@/app/types";
import {
  modalNoticeErrorClass,
  modalNoticeSuccessClass,
  pillGhostClass,
  pillPrimaryClass,
  pillSecondaryClass,
  surfaceCardClass,
  tagClass,
} from "@/react-app/domains/workspace/modal-styles";
import { Button } from "@/components/ui/button";
import { ConfirmModal } from "@/react-app/design-system/modals/confirm-modal";
import {
  SelectMenu,
  type SelectMenuOption,
} from "@/react-app/design-system/select-menu";
import {
  getCompanySkillInstallState,
  type CompanySkillInstallState,
} from "../state/company-skill-sync";

type InstallResult = { ok: boolean; message: string };
type SkillsFilter = "all" | "installed" | "cloud" | "hub";

const pageTitleClass = "text-[28px] font-semibold tracking-[-0.5px] text-dls-text";
const sectionTitleClass = "text-[15px] font-medium tracking-[-0.2px] text-dls-text";
const panelCardClass =
  "rounded-[20px] border border-dls-border bg-dls-surface p-5 transition-all hover:border-dls-border hover:shadow-[0_2px_12px_-4px_rgba(0,0,0,0.06)]";

const OPENWORK_DEFAULT_SKILL_NAMES = new Set([
  "workspace-guide",
  "get-started",
  "skill-creator",
  "command-creator",
  "agent-creator",
  "plugin-creator",
]);

export type ImportedCloudSkillRecord = {
  installedName: string;
  bundleHash?: string | null;
  updatedAt?: string | null;
};

export type SkillsExtensionsStore = {
  skills: () => SkillCard[];
  skillsStatus: () => string | null;
  hubSkills: () => HubSkillCard[];
  hubSkillsStatus: () => string | null;
  cloudOrgSkills: () => DenOrgSkillCard[];
  cloudOrgSkillsStatus: () => string | null;
  importedCloudSkills: () => Record<string, ImportedCloudSkillRecord>;
  hubRepo: () => HubSkillRepo | null;
  hubRepos: () => HubSkillRepo[];
  ensureHubSkillsFresh: () => void | Promise<void>;
  ensureCloudOrgSkillsFresh: () => void | Promise<void>;
  refreshSkills: (options?: { force?: boolean }) => void | Promise<void>;
  refreshHubSkills: (options?: { force?: boolean; query?: string }) => void | Promise<void>;
  refreshCloudOrgSkills: (options?: { force?: boolean }) => void | Promise<void>;
  setHubRepo: (repo: HubSkillRepo) => void | Promise<void>;
  addHubRepo: (repo: HubSkillRepo) => void | Promise<void>;
  removeHubRepo: (repo: HubSkillRepo) => void | Promise<void>;
  installSkillCreator: () => Promise<InstallResult>;
  installCloudOrgSkill: (skill: DenOrgSkillCard) => Promise<InstallResult>;
  installHubSkill: (skill: HubSkillCard) => Promise<InstallResult>;
  importLocalSkill: () => void | Promise<void>;
  revealSkillsFolder: () => void | Promise<void>;
  readSkill: (name: string) => Promise<{ content: string } | null>;
  saveSkill: (input: {
    name: string;
    content: string;
    description?: string;
  }) => void | Promise<void>;
  uninstallSkill: (name: string) => void | Promise<void>;
};

export type SkillsViewProps = {
  workspaceName: string;
  busy: boolean;
  showHeader?: boolean;
  canInstallSkillCreator: boolean;
  canUseDesktopTools: boolean;
  accessHint?: string | null;
  extensions: SkillsExtensionsStore;
  onOpenLink: (url: string) => void;
  createSessionAndOpen: (initialPrompt?: string) => Promise<string | undefined> | string | void;
};

type SkillsViewLocalState = {
  uninstallTarget: SkillCard | null;
  searchQuery: string;
  activeFilter: SkillsFilter;
  shareTarget: SkillCard | null;
  cloudSessionNonce: number;
  shareTeamBusy: boolean;
  shareTeamError: string | null;
  shareTeamSuccess: string | null;
  sharePermissionChoice: string;
  selectedSkill: SkillCard | null;
  selectedContent: string;
  selectedLoading: boolean;
  selectedDirty: boolean;
  selectedError: string | null;
  installingSkillCreator: boolean;
  installingHubSkill: string | null;
  installingCloudSkillId: string | null;
  denUiTick: number;
};

type SkillsViewLocalAction<K extends keyof SkillsViewLocalState = keyof SkillsViewLocalState> =
  | { type: "set"; key: K; value: SetStateAction<any> }
  | { type: "denSessionUpdated" }
  | { type: "closeShare" }
  | { type: "openShare"; skill: SkillCard };

const initialSkillsViewLocalState: SkillsViewLocalState = {
  uninstallTarget: null,
  searchQuery: "",
  activeFilter: "all",
  shareTarget: null,
  cloudSessionNonce: 0,
  shareTeamBusy: false,
  shareTeamError: null,
  shareTeamSuccess: null,
  sharePermissionChoice: "org",
  selectedSkill: null,
  selectedContent: "",
  selectedLoading: false,
  selectedDirty: false,
  selectedError: null,
  installingSkillCreator: false,
  installingHubSkill: null,
  installingCloudSkillId: null,
  denUiTick: 0,
};

function skillsViewLocalReducer(
  state: SkillsViewLocalState,
  action: SkillsViewLocalAction,
): SkillsViewLocalState {
  switch (action.type) {
    case "set": {
      const current = state[action.key];
      const next =
        typeof action.value === "function"
          ? (action.value as (value: typeof current) => typeof current)(current)
          : action.value;
      if (Object.is(current, next)) return state;
      return { ...state, [action.key]: next };
    }
    case "denSessionUpdated":
      return {
        ...state,
        denUiTick: state.denUiTick + 1,
        cloudSessionNonce: state.cloudSessionNonce + 1,
      };
    case "closeShare":
      return {
        ...state,
        shareTarget: null,
        shareTeamBusy: false,
        shareTeamError: null,
        shareTeamSuccess: null,
        sharePermissionChoice: "org",
      };
    case "openShare":
      return {
        ...state,
        shareTarget: action.skill,
        shareTeamBusy: false,
        shareTeamError: null,
        shareTeamSuccess: null,
        sharePermissionChoice: "org",
        cloudSessionNonce: state.cloudSessionNonce + 1,
      };
  }
}

export function SkillsView(props: SkillsViewProps) {
  const { extensions } = props;
  const [localState, dispatchLocal] = useReducer(
    skillsViewLocalReducer,
    initialSkillsViewLocalState,
  );
  const {
    uninstallTarget,
    searchQuery,
    activeFilter,
    shareTarget,
    cloudSessionNonce,
    shareTeamBusy,
    shareTeamError,
    shareTeamSuccess,
    sharePermissionChoice,
    selectedSkill,
    selectedContent,
    selectedLoading,
    selectedDirty,
    selectedError,
    installingSkillCreator,
    installingHubSkill,
    installingCloudSkillId,
    denUiTick,
  } = localState;
  const setLocal = <K extends keyof SkillsViewLocalState>(
    key: K,
    value: SetStateAction<SkillsViewLocalState[K]>,
  ) => dispatchLocal({ type: "set", key, value });
  const setUninstallTarget = (value: SetStateAction<SkillCard | null>) => setLocal("uninstallTarget", value);
  const setSearchQuery = (value: SetStateAction<string>) => setLocal("searchQuery", value);
  const setActiveFilter = (value: SetStateAction<SkillsFilter>) => setLocal("activeFilter", value);
  const setShareTeamBusy = (value: SetStateAction<boolean>) => setLocal("shareTeamBusy", value);
  const setShareTeamError = (value: SetStateAction<string | null>) => setLocal("shareTeamError", value);
  const setShareTeamSuccess = (value: SetStateAction<string | null>) => setLocal("shareTeamSuccess", value);
  const setSharePermissionChoice = (value: SetStateAction<string>) => setLocal("sharePermissionChoice", value);
  const setSelectedSkill = (value: SetStateAction<SkillCard | null>) => setLocal("selectedSkill", value);
  const setSelectedContent = (value: SetStateAction<string>) => setLocal("selectedContent", value);
  const setSelectedLoading = (value: SetStateAction<boolean>) => setLocal("selectedLoading", value);
  const setSelectedDirty = (value: SetStateAction<boolean>) => setLocal("selectedDirty", value);
  const setSelectedError = (value: SetStateAction<string | null>) => setLocal("selectedError", value);
  const setInstallingSkillCreator = (value: SetStateAction<boolean>) => setLocal("installingSkillCreator", value);
  const setInstallingHubSkill = (value: SetStateAction<string | null>) => setLocal("installingHubSkill", value);
  const setInstallingCloudSkillId = (value: SetStateAction<string | null>) => setLocal("installingCloudSkillId", value);

  const maskError = useCallback(
    (value: unknown) => toChineseUserMessage(value, t("common.something_went_wrong")),
    [],
  );

  useEffect(() => {
    void extensions.ensureHubSkillsFresh();
    void extensions.ensureCloudOrgSkillsFresh();
    const onDenSession = () => {
      dispatchLocal({ type: "denSessionUpdated" });
      void extensions.refreshCloudOrgSkills({ force: true });
      void extensions.refreshHubSkills({ force: true });
    };
    window.addEventListener("openwork-den-session-updated", onDenSession);
    return () => window.removeEventListener("openwork-den-session-updated", onDenSession);
  }, [extensions]);

  useEffect(() => {
    if (!shareTarget) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      dispatchLocal({ type: "closeShare" });
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [shareTarget]);

  const shareCloudSignedIn = useMemo(() => {
    cloudSessionNonce;
    return Boolean(readDenSettings().authToken?.trim());
  }, [cloudSessionNonce]);

  const shareTeamOrgLabel = useMemo(() => {
    cloudSessionNonce;
    const name = readDenSettings().activeOrgName?.trim();
    return name || t("skills.share_team_org_fallback");
  }, [cloudSessionNonce]);

  const shareTeamDisabledReason = useMemo(() => {
    if (!shareCloudSignedIn) return null;
    const settings = readDenSettings();
    if (!settings.activeOrgId?.trim() && !settings.activeOrgSlug?.trim()) {
      return t("skills.share_team_choose_org");
    }
    return null;
  }, [shareCloudSignedIn]);

  const skills = extensions.skills();
  const hubSkills = extensions.hubSkills();
  const cloudOrgSkills = extensions.cloudOrgSkills();
  const importedCloudSkills = extensions.importedCloudSkills();
  const skillsStatus = extensions.skillsStatus();
  const hubSkillsStatus = extensions.hubSkillsStatus();
  const cloudOrgSkillsStatus = extensions.cloudOrgSkillsStatus();

  const skillCreatorInstalled = useMemo(
    () => skills.some((skill) => skill.name === "skill-creator"),
    [skills],
  );

  const filteredSkills = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return skills;
    return skills.filter((skill) => {
      const description = skill.description ?? "";
      return skill.name.toLowerCase().includes(query) || description.toLowerCase().includes(query);
    });
  }, [searchQuery, skills]);

  const installedNames = useMemo(() => new Set(skills.map((skill) => skill.name)), [skills]);

  const filteredHubSkills = useMemo(() => {
    return hubSkills.filter((skill) => !installedNames.has(skill.slug));
  }, [hubSkills, installedNames]);

  const filteredCloudOrgSkills = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return cloudOrgSkills;
    return cloudOrgSkills.filter((skill) => {
      const description = skill.description ?? "";
      return (
        skill.title.toLowerCase().includes(query) ||
        description.toLowerCase().includes(query)
      );
    });
  }, [cloudOrgSkills, searchQuery]);

  const cloudSkillInstallState = useCallback(
    (skill: DenOrgSkillCard): CompanySkillInstallState =>
      getCompanySkillInstallState(skill, importedCloudSkills[skill.id], installedNames),
    [importedCloudSkills, installedNames],
  );

  const cloudOrgLabel = useMemo(() => {
    denUiTick;
    const name = readDenSettings().activeOrgName?.trim();
    return name || t("skills.cloud_org_fallback");
  }, [denUiTick]);

  const cloudSessionReady = useMemo(() => {
    denUiTick;
    const settings = readDenSettings();
    return Boolean(settings.authToken?.trim() && settings.activeOrgId?.trim());
  }, [denUiTick]);

  const cloudNeedsSignIn = useMemo(() => {
    denUiTick;
    return !readDenSettings().authToken?.trim();
  }, [denUiTick]);

  const sharePermissionOptions = useMemo<SelectMenuOption[]>(
    () => [
      { value: "private", label: t("skills.share_team_permission_private") },
      { value: "org", label: t("skills.share_team_permission_org") },
    ],
    [],
  );

  const shareModalSubtitle = t("skills.share_subtitle_team");

  const showInstalledSection = activeFilter === "all" || activeFilter === "installed";
  const showCloudSection = activeFilter === "all" || activeFilter === "cloud";
  const showHubSection = activeFilter === "all" || activeFilter === "hub";
  const canCreateInChat = !props.busy && (props.canInstallSkillCreator || props.canUseDesktopTools);

  useEffect(() => {
    if (!showHubSection) return;
    const query = searchQuery.trim();
    const timer = window.setTimeout(() => {
      void extensions.refreshHubSkills({ force: true, query: query.length >= 2 ? query : "" });
    }, 300);
    return () => window.clearTimeout(timer);
  }, [extensions, searchQuery, showHubSection]);

  const resolveSharePermission = () => {
    const choice = sharePermissionChoice.trim();
    if (choice === "private") return { shared: null };
    return { shared: "org" as const };
  };

  const closeShareLink = useCallback(() => {
    dispatchLocal({ type: "closeShare" });
  }, []);

  const runDesktopAction = useCallback(
    (action: () => void | Promise<void>) => {
      if (props.busy) return;
      if (!props.canUseDesktopTools) {
        toast.warning(t("skills.desktop_required"));
        return;
      }
      void Promise.resolve(action());
    },
    [props.busy, props.canUseDesktopTools],
  );

  const refreshCatalogs = useCallback(() => {
    if (props.busy) return;
    void extensions.refreshSkills({ force: true });
    void extensions.refreshHubSkills({ force: true, query: searchQuery.trim() });
    void extensions.refreshCloudOrgSkills({ force: true });
  }, [extensions, props.busy, searchQuery]);

  const installSkillCreator = useCallback(async () => {
    if (props.busy || installingSkillCreator) return;
    if (!props.canInstallSkillCreator) {
      toast.warning(props.accessHint ?? t("skills.host_only_error"));
      return;
    }
    setInstallingSkillCreator(true);
    toast.info(t("skills.installing_skill_creator"));
    try {
      const result = await extensions.installSkillCreator();
      toast.success(result.message);
    } catch (error) {
      toast.error(maskError(error));
    } finally {
      setInstallingSkillCreator(false);
    }
  }, [extensions, installingSkillCreator, maskError, props.accessHint, props.busy, props.canInstallSkillCreator]);

  const installFromCloud = useCallback(
    async (skill: DenOrgSkillCard) => {
      if (props.busy || installingCloudSkillId) return;
      const state = cloudSkillInstallState(skill);
      if (state === "installed") return;
      setInstallingCloudSkillId(skill.id);
      toast.info(
        t(state === "update" ? "skills.cloud_updating" : "skills.cloud_installing", undefined, { title: skill.title }),
      );
      try {
        const result = await extensions.installCloudOrgSkill(skill);
        if (result.ok) {
          toast.success(result.message);
        } else {
          toast.error(result.message);
        }
      } catch (error) {
        toast.error(maskError(error));
      } finally {
        setInstallingCloudSkillId(null);
      }
    },
    [cloudSkillInstallState, extensions, installingCloudSkillId, maskError, props.busy],
  );

  const installFromHub = useCallback(
    async (skill: HubSkillCard) => {
      if (props.busy || installingHubSkill) return;
      setInstallingHubSkill(skill.id);
      toast.info(t("skills.online_install_checking", undefined, { name: skill.name }));
      try {
        const result = await extensions.installHubSkill(skill);
        if (result.ok) toast.success(result.message);
        else toast.error(result.message);
      } catch (error) {
        toast.error(maskError(error));
      } finally {
        setInstallingHubSkill(null);
      }
    },
    [extensions, installingHubSkill, maskError, props.busy],
  );

  const handleNewSkill = useCallback(async () => {
    if (props.busy) return;
    if (props.canInstallSkillCreator && !skillCreatorInstalled) {
      await installSkillCreator();
    }
    await Promise.resolve(props.createSessionAndOpen("/skill-creator"));
  }, [installSkillCreator, props, skillCreatorInstalled]);

  const openCloudSignIn = useCallback(() => {
    const base = readDenSettings().baseUrl?.trim() || DEFAULT_DEN_BASE_URL;
    // 注册页也允许已有员工切换到登录，因此统一从公司账号入口打开。
    props.onOpenLink(buildDenAuthUrl(base, "sign-up"));
  }, [props]);

  const openShareLink = useCallback(
    (skill: SkillCard) => {
      if (props.busy) return;
      dispatchLocal({ type: "openShare", skill });
    },
    [props.busy],
  );

  const startShareSkillSignIn = useCallback(() => {
    const settings = readDenSettings();
    // Label stays "Sign in"; opens the sign-up tab (returning users can toggle).
    props.onOpenLink(buildDenAuthUrl(settings.baseUrl, "sign-up"));
  }, [props]);

  const publishSkillToTeam = useCallback(async () => {
    if (!shareTarget || props.busy || shareTeamBusy || shareTeamDisabledReason) return;
    setShareTeamBusy(true);
    setShareTeamError(null);
    setShareTeamSuccess(null);
    try {
      const skill = await extensions.readSkill(shareTarget.name);
      if (!skill) throw new Error("无法读取该技能，请刷新后重试。");
      const sharing = resolveSharePermission();
      const { orgName, orgId } = await saveInstalledSkillToOpenWorkOrg({
        skillText: skill.content,
        shared: sharing.shared,
      });
      setShareTeamSuccess(t("skills.share_team_uploaded_success", undefined, { org: orgName }));
      window.dispatchEvent(
        new CustomEvent<{ orgId: string }>("openwork-den-org-skills-changed", {
          detail: { orgId },
        }),
      );
      void extensions.refreshCloudOrgSkills({ force: true });
    } catch (error) {
      setShareTeamError(maskError(error));
    } finally {
      setShareTeamBusy(false);
    }
  }, [extensions, maskError, props.busy, shareTarget, shareTeamBusy, shareTeamDisabledReason]);

  const openSkill = useCallback(
    async (skill: SkillCard) => {
      if (props.busy) return;
      setSelectedSkill(skill);
      setSelectedContent("");
      setSelectedDirty(false);
      setSelectedError(null);
      setSelectedLoading(true);
      try {
        const result = await extensions.readSkill(skill.name);
        if (!result) {
          setSelectedError(t("skills.skill_load_failed"));
          return;
        }
        setSelectedContent(result.content);
      } catch (error) {
        setSelectedError(maskError(error));
      } finally {
        setSelectedLoading(false);
      }
    },
    [extensions, maskError, props.busy],
  );

  const saveSelectedSkill = useCallback(async () => {
    if (!selectedSkill || !selectedDirty) return;
    setSelectedError(null);
    try {
      await Promise.resolve(
        extensions.saveSkill({
          name: selectedSkill.name,
          content: selectedContent,
          description: selectedSkill.description,
        }),
      );
      setSelectedDirty(false);
    } catch (error) {
      setSelectedError(maskError(error));
    }
  }, [extensions, maskError, selectedContent, selectedDirty, selectedSkill]);

  const isOpenworkInjectedSkill = (skill: SkillCard) => {
    const normalizedName = skill.name.trim().toLowerCase();
    const normalizedPath = skill.path.replace(/\\/g, "/").toLowerCase();
    return normalizedPath.includes("/.opencode/skills/") &&
      (OPENWORK_DEFAULT_SKILL_NAMES.has(normalizedName) || normalizedName.endsWith("-creator"));
  };

  const handleSkillCardKeyDown = (
    event: ReactKeyboardEvent<HTMLDivElement>,
    skill: SkillCard,
  ) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    void openSkill(skill);
  };

  return (
    <section className="space-y-8 max-w-3xl w-full">
      <div className="space-y-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            {props.showHeader !== false ? <h2 className={pageTitleClass}>{t("skills.title")}</h2> : null}
            <p className="mt-2 max-w-2xl text-[14px] leading-relaxed text-dls-secondary">
              {t("skills.worker_profile_desc")}
            </p>
          </div>

          <div className="flex flex-wrap gap-3 lg:justify-end">
            <button
              type="button"
              onClick={() => runDesktopAction(extensions.importLocalSkill)}
              disabled={props.busy || !props.canUseDesktopTools}
              className={pillSecondaryClass}
            >
              <Upload size={14} />
              {t("skills.import_local_skill")}
            </button>
            <button
              type="button"
              onClick={() => runDesktopAction(extensions.revealSkillsFolder)}
              disabled={props.busy || !props.canUseDesktopTools}
              className={pillSecondaryClass}
            >
              <FolderOpen size={14} />
              {t("skills.reveal_folder")}
            </button>
            <button type="button" onClick={() => void handleNewSkill()} disabled={!canCreateInChat} className={pillPrimaryClass}>
              <Sparkles size={14} />
              {t("skills.create_in_chat")}
            </button>
          </div>
        </div>

        <div className="flex flex-col gap-3 rounded-[20px] border border-dls-border bg-dls-surface p-4 md:flex-row md:items-center md:justify-between">
          <div className="relative min-w-0 flex-1">
            <Search size={16} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-dls-secondary" />
            <input
              type="text"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.currentTarget.value)}
              placeholder={t("skills.catalog_search_placeholder")}
              className="w-full rounded-xl border border-dls-border bg-dls-surface py-3 pl-11 pr-4 text-[14px] text-dls-text focus:outline-none focus:ring-2 focus:ring-[rgba(var(--dls-accent-rgb),0.12)]"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {(["all", "installed", "cloud", "hub"] as SkillsFilter[]).map((filter) => (
              <button
                key={filter}
                type="button"
                onClick={() => setActiveFilter(filter)}
                className={activeFilter === filter ? pillPrimaryClass : pillGhostClass}
              >
                {filter === "all"
                  ? t("skills.filter_all")
                  : filter === "installed"
                    ? t("skills.filter_installed")
                    : filter === "cloud"
                      ? t("skills.filter_cloud")
                      : t("skills.filter_hub")}
              </button>
            ))}
            <button type="button" onClick={refreshCatalogs} disabled={props.busy} className={pillSecondaryClass}>
              <RefreshCw size={14} />
              {t("common.refresh")}
            </button>
          </div>
        </div>
      </div>

      {props.accessHint ? (
        <div className="rounded-[20px] border border-dls-border bg-dls-hover px-5 py-4 text-[13px] text-dls-secondary">
          {props.accessHint}
        </div>
      ) : null}
      {!props.accessHint && !props.canInstallSkillCreator && !props.canUseDesktopTools ? (
        <div className="rounded-[20px] border border-dls-border bg-dls-hover px-5 py-4 text-[13px] text-dls-secondary">
          {t("skills.host_mode_only")}
        </div>
      ) : null}

      {skillsStatus ? (
        <div className="whitespace-pre-wrap break-words rounded-[20px] border border-dls-border bg-dls-hover px-5 py-4 text-[13px] text-dls-secondary">
          {skillsStatus}
        </div>
      ) : null}

      {showInstalledSection ? (
        <div className="space-y-4">
          <div className="flex items-end justify-between gap-3">
            <div>
              <h3 className={sectionTitleClass}>{t("skills.installed")}</h3>
              <p className="mt-1 text-[13px] text-dls-secondary">{t("skills.installed_desc")}</p>
            </div>
            <div className="text-[12px] text-dls-secondary">{t("skills.shown_count", undefined, { count: filteredSkills.length })}</div>
          </div>

          {filteredSkills.length === 0 ? (
            <div className="rounded-[20px] border border-dashed border-dls-border bg-dls-surface px-5 py-8 text-[14px] text-dls-secondary">
              {t("skills.no_skills")}
            </div>
          ) : (
            <div className="rounded-[24px] bg-dls-hover p-4">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                {filteredSkills.map((skill) => (
                  <div
                    key={skill.path}
                    role="button"
                    tabIndex={0}
                    className={`${panelCardClass} flex cursor-pointer flex-col gap-4 text-left`}
                    onClick={() => void openSkill(skill)}
                    onKeyDown={(event) => handleSkillCardKeyDown(event, skill)}
                  >
                    <div className="flex min-w-0 gap-4">
                      <div className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-dls-border bg-dls-hover">
                        <Package size={20} className="text-dls-secondary" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <h4 className="truncate text-[14px] font-semibold text-dls-text">{skill.name}</h4>
                          {isOpenworkInjectedSkill(skill) ? <span className={tagClass}>FoxWork</span> : null}
                        </div>
                        <p className="mt-2 line-clamp-2 text-[13px] leading-relaxed text-dls-secondary">
                          {skill.description || t("skills.no_description")}
                        </p>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-dls-border pt-4">
                      <span className={tagClass}>{t("skills.installed_status")}</span>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          className={pillGhostClass}
                          onClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            openShareLink(skill);
                          }}
                          disabled={props.busy}
                          title={t("skills.share_option_team_title")}
                        >
                          <Users size={14} />
                          {t("skills.share_option_team_title")}
                        </button>
                        <button
                          type="button"
                          className={pillSecondaryClass}
                          onClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            void openSkill(skill);
                          }}
                          disabled={props.busy}
                          title={t("common.edit")}
                        >
                          <Edit2 size={14} />
                          {t("common.edit")}
                        </button>
                        <button
                          type="button"
                          className={pillGhostClass}
                          onClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            if (props.busy || !props.canUseDesktopTools) {
                              if (!props.canUseDesktopTools) toast.warning(t("skills.desktop_required"));
                              return;
                            }
                            setUninstallTarget(skill);
                          }}
                          disabled={props.busy || !props.canUseDesktopTools}
                          title={t("skills.uninstall")}
                        >
                          <Trash2 size={14} />
                          {t("common.remove")}
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      ) : null}

      {showCloudSection ? (
        <div className="space-y-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="mb-0.5 text-[12px] text-dls-secondary">{cloudOrgLabel}</p>
              <h3 className={sectionTitleClass}>{t("skills.cloud_section_title")}</h3>
              <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-dls-secondary">
                {t("skills.cloud_section_subtitle")}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => void extensions.refreshCloudOrgSkills({ force: true })}
                disabled={props.busy}
                className={pillSecondaryClass}
              >
                <RefreshCw size={14} />
                {t("skills.cloud_refresh")}
              </button>
            </div>
          </div>

          {!cloudSessionReady ? (
            <div className="rounded-[20px] border border-dashed border-dls-border bg-dls-surface px-5 py-6 text-[14px] text-dls-secondary">
              {cloudNeedsSignIn ? (
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <p>{t("skills.cloud_sign_in_hint")}</p>
                  <button type="button" className={pillPrimaryClass} onClick={openCloudSignIn}>
                    {t("skills.cloud_sign_in")}
                  </button>
                </div>
              ) : (
                <div className="space-y-3">
                  <p>{t("skills.cloud_choose_org_hint")}</p>
                  <p className="text-[13px]">{t("skills.cloud_choose_org_detail")}</p>
                </div>
              )}
            </div>
          ) : (
            <>
              {cloudOrgSkillsStatus ? (
                <div className="whitespace-pre-wrap break-words rounded-[20px] border border-dls-border bg-dls-hover px-5 py-4 text-[13px] text-dls-secondary">
                  {cloudOrgSkillsStatus}
                </div>
              ) : null}

              {filteredCloudOrgSkills.length === 0 ? (
                <div className="rounded-[20px] border border-dashed border-dls-border bg-dls-surface px-5 py-8 text-[14px] text-dls-secondary">
                  {cloudOrgSkills.length === 0 ? t("skills.cloud_org_empty") : t("skills.cloud_no_search_matches")}
                </div>
              ) : (
                <div className="rounded-[24px] bg-dls-hover p-4">
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    {filteredCloudOrgSkills.map((skill) => {
                      const state = cloudSkillInstallState(skill);
                      const installedName = importedCloudSkills[skill.id]?.installedName ?? null;
                      return (
                        <div key={skill.id} className={`${panelCardClass} flex flex-col gap-4 text-left`}>
                          <div className="flex min-w-0 gap-4">
                            <div className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-dls-border bg-dls-hover">
                              <Cloud size={20} className="text-dls-secondary" />
                            </div>
                            <div className="min-w-0 flex-1">
                              <h4 className="truncate text-[14px] font-semibold text-dls-text">{skill.title}</h4>
                              {skill.description ? (
                                <p className="mt-2 line-clamp-2 text-[13px] leading-relaxed text-dls-secondary">{skill.description}</p>
                              ) : null}
                              <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-dls-secondary">
                                {skill.shared === "org" ? <span className={tagClass}>{t("skills.cloud_shared_org")}</span> : null}
                                {skill.shared === "public" ? <span className={tagClass}>{t("skills.cloud_shared_public")}</span> : null}
                                {skill.shared === null ? <span className={tagClass}>{t("skills.cloud_shared_private")}</span> : null}
                                {installedName ? <span className={tagClass}>{t("skills.cloud_installed_as", undefined, { name: installedName })}</span> : null}
                                {state === "installed" ? <span className={tagClass}>{t("skills.cloud_status_installed")}</span> : null}
                                {state === "update" ? <span className={tagClass}>{t("skills.cloud_status_update")}</span> : null}
                              </div>
                            </div>
                          </div>

                          <div className="flex items-center justify-between gap-3 border-t border-dls-border pt-4">
                            <span className={tagClass}>{t("skills.cloud_footer_label")}</span>
                            <button
                              type="button"
                              className={installingCloudSkillId === skill.id || state === "installed" ? pillSecondaryClass : pillPrimaryClass}
                              onClick={(event) => {
                                event.preventDefault();
                                event.stopPropagation();
                                void installFromCloud(skill);
                              }}
                              disabled={props.busy || installingCloudSkillId === skill.id || state === "installed"}
                            >
                              {installingCloudSkillId === skill.id ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
                              {installingCloudSkillId === skill.id
                                ? t("skills.cloud_installing_short")
                                : state === "update"
                                  ? t("skills.cloud_update_skill")
                                  : state === "installed"
                                    ? t("skills.cloud_status_installed")
                                    : t("skills.install")}
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      ) : null}

      {showHubSection ? (
        <div className="space-y-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <h3 className={sectionTitleClass}>{t("skills.online_title")}</h3>
              <p className="mt-1 text-[13px] text-dls-secondary">{t("skills.online_desc")}</p>
            </div>
            <button
              type="button"
              onClick={() => void extensions.refreshHubSkills({ force: true, query: searchQuery.trim() })}
              disabled={props.busy}
              className={pillSecondaryClass}
            >
              <RefreshCw size={14} />
              {t("skills.online_refresh")}
            </button>
          </div>

          {hubSkillsStatus ? (
            <div className="whitespace-pre-wrap break-words rounded-[20px] border border-dls-border bg-dls-hover px-5 py-4 text-[13px] text-dls-secondary">
              {hubSkillsStatus}
            </div>
          ) : null}

          {filteredHubSkills.length === 0 ? (
            <div className="rounded-[20px] border border-dashed border-dls-border bg-dls-surface px-5 py-8 text-[14px] text-dls-secondary">
              {t("skills.online_empty")}
            </div>
          ) : (
            <div className="rounded-[24px] bg-dls-hover p-4">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                {filteredHubSkills.map((skill) => (
                  <div key={skill.id} className={`${panelCardClass} flex min-w-0 flex-col gap-4 text-left`}>
                    <div className="flex min-w-0 gap-4">
                      <div className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-dls-border bg-dls-hover">
                        <Package size={20} className="text-dls-secondary" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <h4 className="truncate text-[14px] font-semibold text-dls-text">{skill.name}</h4>
                        <p className="mt-2 line-clamp-2 text-[13px] leading-relaxed text-dls-secondary">{skill.source}</p>
                        <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-dls-secondary">
                          <span className={tagClass}>{t("skills.online_install_count", undefined, { count: skill.installs })}</span>
                          <span className={tagClass}>{t("skills.online_verified_source")}</span>
                        </div>
                      </div>
                    </div>

                    <div className="flex min-w-0 flex-wrap items-center gap-3 border-t border-dls-border pt-4">
                      <span className={`${tagClass} shrink-0 gap-1 whitespace-nowrap`}>
                        <ShieldCheck size={12} />
                        {t("skills.online_audit_before_install")}
                      </span>
                      <div className="ml-auto flex shrink-0 items-center gap-2">
                        <button
                          type="button"
                          className={`${pillGhostClass} shrink-0`}
                          onClick={() => props.onOpenLink(skill.url)}
                          disabled={props.busy}
                          title={t("skills.online_view_source")}
                          aria-label={t("skills.online_view_source")}
                        >
                          <SquareArrowOutUpRight size={14} />
                        </button>
                        <button
                          type="button"
                          className={`${installingHubSkill === skill.id ? pillSecondaryClass : pillPrimaryClass} shrink-0 whitespace-nowrap`}
                          onClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            void installFromHub(skill);
                          }}
                          disabled={props.busy || installingHubSkill === skill.id}
                          title={t("skills.install_name_title", undefined, { name: skill.name })}
                        >
                          {installingHubSkill === skill.id ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
                          {installingHubSkill === skill.id ? t("skills.installing") : t("skills.install")}
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      ) : null}

      <Dialog
        open={Boolean(selectedSkill)}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedSkill(null);
            setSelectedContent("");
            setSelectedDirty(false);
            setSelectedError(null);
            setSelectedLoading(false);
          }
        }}
      >
        <DialogContent className="flex max-h-[90vh] min-h-0 w-full max-w-4xl flex-col overflow-hidden sm:max-w-4xl">
            <DialogHeader>
              <div className="flex min-w-0 items-center gap-3">
                <DialogTitle className="min-w-0 flex-1 truncate">{selectedSkill?.name}</DialogTitle>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    disabled={!selectedDirty || props.busy}
                    onClick={() => void saveSelectedSkill()}
                  >
                    {t("common.save")}
                  </Button>
                </div>
              </div>
            </DialogHeader>

            <div className="min-h-0 flex-1 overflow-y-auto">
              {selectedError ? <div className="mb-3 rounded-xl border border-red-7/20 bg-red-1/40 px-4 py-3 text-xs text-red-12">{selectedError}</div> : null}
              {selectedLoading ? (
                <div className="text-xs text-dls-secondary">{t("skills.loading")}</div>
              ) : (
                <textarea
                  value={selectedContent}
                  onChange={(event) => {
                    setSelectedContent(event.currentTarget.value);
                    setSelectedDirty(true);
                  }}
                  className="min-h-[420px] w-full rounded-xl border border-dls-border bg-dls-hover px-4 py-3 text-xs font-mono text-dls-text focus:outline-none focus:ring-2 focus:ring-[rgba(var(--dls-accent-rgb),0.25)]"
                  spellCheck={false}
                />
              )}
            </div>
        </DialogContent>
      </Dialog>

      <ConfirmModal
        open={Boolean(uninstallTarget)}
        title={t("skills.uninstall_title")}
        message={t("skills.uninstall_warning").replace("{name}", uninstallTarget?.name ?? "")}
        confirmLabel={t("skills.uninstall")}
        cancelLabel={t("common.cancel")}
        confirmButtonVariant="destructive"
        onCancel={() => setUninstallTarget(null)}
        onConfirm={() => {
          const target = uninstallTarget;
          setUninstallTarget(null);
          if (!target) return;
          void extensions.uninstallSkill(target.name);
        }}
      />

      <Dialog
        open={Boolean(shareTarget)}
        onOpenChange={(open) => {
          if (!open) closeShareLink();
        }}
      >
        <DialogContent className="flex max-h-[78vh] min-h-0 w-full max-w-md flex-col overflow-hidden sm:max-w-md">
          <DialogHeader>
            <div className="min-w-0 flex flex-col gap-1.5">
              <div className="flex flex-wrap items-center gap-2">
                <DialogTitle>{t("skills.share_title")}</DialogTitle>
                <span className={tagClass}>{shareTarget?.name}</span>
              </div>
              <DialogDescription>{shareModalSubtitle}</DialogDescription>
            </div>
          </DialogHeader>

          <div className="min-h-0 flex-1 overflow-y-auto">
            <div className="space-y-5 pt-2">
              <p className="text-[14px] leading-relaxed text-dls-secondary">{t("skills.share_team_permissions_intro")}</p>
              <div className={surfaceCardClass}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className={tagClass}>{shareTeamOrgLabel}</span>
                </div>
                {shareTeamError?.trim() ? <div className={`mt-4 ${modalNoticeErrorClass}`}>{shareTeamError}</div> : null}
                {shareTeamSuccess?.trim() ? <div className={`mt-4 ${modalNoticeSuccessClass}`}>{shareTeamSuccess}</div> : null}
                {shareCloudSignedIn && shareTeamDisabledReason?.trim() ? (
                  <div className="mt-4 text-[12px] text-dls-secondary">{shareTeamDisabledReason}</div>
                ) : null}
                {shareCloudSignedIn ? (
                  <div className="mt-4">
                    <span id="skills-share-hub-label" className="mb-1.5 block text-[13px] font-medium text-dls-text">
                      {t("skills.share_team_permissions_label")}
                    </span>
                    <SelectMenu
                      ariaLabelledBy="skills-share-hub-label"
                      options={sharePermissionOptions}
                      value={sharePermissionChoice}
                      onChange={setSharePermissionChoice}
                      disabled={shareTeamBusy || Boolean(shareTeamSuccess?.trim())}
                    />
                  </div>
                ) : null}
                <button
                  type="button"
                  onClick={() => {
                    if (!shareCloudSignedIn) {
                      startShareSkillSignIn();
                      return;
                    }
                    void publishSkillToTeam();
                  }}
                  disabled={shareCloudSignedIn ? Boolean(shareTeamDisabledReason) || shareTeamBusy || Boolean(shareTeamSuccess?.trim()) : false}
                  className={`${pillPrimaryClass} mt-4 w-full`}
                >
                  {!shareCloudSignedIn
                    ? t("skills.share_team_sign_in")
                    : shareTeamBusy
                      ? t("skills.share_team_uploading")
                      : t("skills.share_team_upload_and_save")}
                </button>
                {!shareCloudSignedIn ? <p className="mt-3 text-[12px] text-dls-secondary">{t("skills.share_team_sign_in_hint")}</p> : null}
              </div>
            </div>
          </div>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>
              {t("skills.share_done")}
            </DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </section>
  );
}

export default SkillsView;
