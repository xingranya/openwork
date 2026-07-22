/** @jsxImportSource react */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Check,
  ChevronRight,
  FileSearch,
  FolderKanban,
  ListChecks,
  Play,
  RefreshCw,
  ShieldCheck,
  X,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  getBrandProjectEvidence,
  getBrandProjectStatus,
  getBrandProjectTaskPacket,
  getBrandProjectView,
  recordObject,
  recordStrings,
  recordText,
  reviewBrandProjectProposal,
  taskPacketPrompt,
  type BrandProjectRecord,
  type BrandProjectView,
  type ProposalReviewAction,
} from "@/app/lib/brand-project";
import { t } from "@/i18n";


type BrandProjectWorkspaceProps = {
  onStartAiTask?: (prompt: string) => void;
};

const MINIMUM_LOAD_VISIBLE_MS = 250;

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message.trim()
    ? error.message
    : t("brand_project.error_unknown");
}

function formatDate(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) return t("common.unknown");
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) return value;
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(timestamp);
}

function payloadTitle(value: BrandProjectRecord): string {
  const payload = recordObject(value, "payload") ?? recordObject(value, "after") ?? value;
  return recordText(payload, "statement", "question", "title", "name", "goal", "id")
    || recordText(value, "item_id", "proposal_id", "task_id")
    || t("brand_project.untitled_item");
}

function proposalStatusLabel(value: string): string {
  const labels: Record<string, string> = {
    proposed: t("brand_project.status_pending"),
    approved: t("brand_project.status_approved"),
    rejected: t("brand_project.status_rejected"),
    superseded: t("brand_project.status_superseded"),
  };
  return labels[value] ?? t("common.unknown");
}

function classificationLabel(value: string): string {
  const labels: Record<string, string> = {
    FACT: t("brand_project.type_fact"),
    VIEW: t("brand_project.type_view"),
    PREFERENCE: t("brand_project.type_preference"),
    HYPOTHESIS: t("brand_project.type_hypothesis"),
    OPTION: t("brand_project.type_option"),
    TENDENCY: t("brand_project.type_tendency"),
    TARGET_DATE: t("brand_project.type_target_date"),
    DECISION_CANDIDATE: t("brand_project.type_decision"),
    CONSTRAINT_CANDIDATE: t("brand_project.type_constraint"),
    ACTION_CANDIDATE: t("brand_project.type_action"),
    OPEN: t("brand_project.type_open_question"),
  };
  return labels[value] ?? t("brand_project.type_change");
}

function modeLabel(value: string): string {
  const labels: Record<string, string> = {
    EXPLORATION: t("brand_project.mode_exploration"),
    EVALUATION: t("brand_project.mode_evaluation"),
    DECISION: t("brand_project.mode_decision"),
    EXECUTION: t("brand_project.mode_execution"),
  };
  return labels[value] ?? t("common.unknown");
}

function roleLabel(value: string): string {
  const labels: Record<string, string> = {
    BRAND_STRATEGIST: t("brand_project.role_strategist"),
    BRAND_RESEARCHER: t("brand_project.role_researcher"),
    CREATIVE_PARTNER: t("brand_project.role_creative"),
    EXECUTION_PARTNER: t("brand_project.role_execution"),
  };
  return labels[value] ?? t("common.unknown");
}

function EmptyRows({ message }: { message: string }) {
  return (
    <div className="border-y border-border px-4 py-10 text-center text-sm text-muted-foreground">
      {message}
    </div>
  );
}

function SectionHeading({ title, count }: { title: string; count?: number }) {
  return (
    <div className="flex items-center justify-between gap-4 pb-3">
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      {typeof count === "number" ? <span className="text-xs text-muted-foreground">{count}</span> : null}
    </div>
  );
}

function OverviewTab({ view }: { view: BrandProjectView }) {
  return (
    <div className="space-y-8 py-6">
      <section>
        <SectionHeading title={t("brand_project.current_state")} count={view.currentState.length} />
        {view.currentState.length === 0 ? (
          <EmptyRows message={t("brand_project.empty_current_state")} />
        ) : (
          <div className="divide-y divide-border border-y border-border">
            {view.currentState.map((item) => (
              <div key={recordText(item, "item_id")} className="grid gap-1 px-4 py-3 md:grid-cols-[160px_1fr]">
                <span className="text-xs text-muted-foreground">{classificationLabel(recordText(item, "item_type"))}</span>
                <span className="text-sm text-foreground">{payloadTitle(item)}</span>
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <SectionHeading title={t("brand_project.open_questions")} count={view.openQuestions.length} />
        {view.openQuestions.length === 0 ? (
          <EmptyRows message={t("brand_project.empty_open_questions")} />
        ) : (
          <div className="divide-y divide-border border-y border-border">
            {view.openQuestions.map((item) => (
              <div key={recordText(item, "item_id")} className="px-4 py-3 text-sm text-foreground">
                {payloadTitle(item)}
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <SectionHeading title={t("brand_project.known_gaps")} count={view.knownGaps.length} />
        {view.knownGaps.length === 0 ? (
          <EmptyRows message={t("brand_project.empty_known_gaps")} />
        ) : (
          <div className="divide-y divide-border border-y border-border">
            {view.knownGaps.slice(0, 5).map((gap) => (
              <div key={recordText(gap, "gap_id")} className="grid gap-1 px-4 py-3 md:grid-cols-[1fr_180px]">
                <span className="text-sm text-foreground">{recordText(gap, "description")}</span>
                <span className="text-xs text-muted-foreground md:text-right">{recordText(gap, "scope", "status")}</span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function SourcesTab({ view }: { view: BrandProjectView }) {
  if (view.sources.length === 0) return <EmptyRows message={t("brand_project.empty_sources")} />;
  return (
    <div className="py-4">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("brand_project.source_name")}</TableHead>
            <TableHead>{t("brand_project.source_role")}</TableHead>
            <TableHead>{t("brand_project.source_version")}</TableHead>
            <TableHead>{t("brand_project.source_check")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {view.sources.map((source) => (
            <TableRow key={recordText(source, "source_version_id")}>
              <TableCell className="max-w-[460px] whitespace-normal font-medium">
                {recordText(source, "relative_path", "logical_source_id")}
              </TableCell>
              <TableCell>{recordText(source, "source_role") || t("common.unknown")}</TableCell>
              <TableCell>{recordText(source, "version_label") || t("common.unknown")}</TableCell>
              <TableCell className="font-mono text-xs text-muted-foreground">
                {recordText(source, "sha256").slice(0, 12) || t("common.unknown")}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

type ProposalDetailProps = {
  proposal: BrandProjectRecord;
  stateVersion: number;
  onReviewed: () => Promise<void>;
};

function ProposalDetail({ proposal, stateVersion, onReviewed }: ProposalDetailProps) {
  const [reason, setReason] = useState("");
  const [editedAfter, setEditedAfter] = useState(() => JSON.stringify(recordObject(proposal, "after") ?? {}, null, 2));
  const [busyAction, setBusyAction] = useState<ProposalReviewAction | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [evidence, setEvidence] = useState<BrandProjectRecord | null>(null);
  const [evidenceBusy, setEvidenceBusy] = useState(false);
  const evidenceRefs = recordStrings(proposal, "evidence_refs");
  const status = recordText(proposal, "status");

  useEffect(() => {
    setReason("");
    setEditedAfter(JSON.stringify(recordObject(proposal, "after") ?? {}, null, 2));
    setError(null);
    setNotice(null);
    setEvidence(null);
  }, [proposal]);

  const openEvidence = async (evidenceRef: string) => {
    setEvidenceBusy(true);
    setError(null);
    try {
      setEvidence(await getBrandProjectEvidence(evidenceRef));
    } catch (nextError) {
      setError(errorMessage(nextError));
    } finally {
      setEvidenceBusy(false);
    }
  };

  const review = async (action: ProposalReviewAction) => {
    if (!reason.trim()) {
      setError(t("brand_project.review_reason_required"));
      return;
    }
    setBusyAction(action);
    setError(null);
    setNotice(null);
    try {
      let replacementAfter: BrandProjectRecord | undefined;
      if (action === "modify_and_approve") {
        const parsed: unknown = JSON.parse(editedAfter);
        if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
          throw new Error(t("brand_project.review_content_invalid"));
        }
        replacementAfter = parsed as BrandProjectRecord;
      }
      const result = await reviewBrandProjectProposal({
        schema_version: "desktop-proposal-review.v1",
        proposal_id: recordText(proposal, "proposal_id"),
        action,
        reason: reason.trim(),
        ...(replacementAfter ? { replacement_after: replacementAfter } : {}),
        expected_version: stateVersion,
        idempotency_key: `${recordText(proposal, "proposal_id")}:${action}:${stateVersion}:${crypto.randomUUID()}`,
      });
      if (result === "completed") {
        await onReviewed();
      } else {
        setNotice(t("brand_project.review_cancelled"));
      }
    } catch (nextError) {
      setError(errorMessage(nextError));
    } finally {
      setBusyAction(null);
    }
  };

  return (
    <section className="border-t border-border pt-6" data-testid="brand-project-proposal-detail">
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1.2fr)_minmax(280px,0.8fr)]">
        <div className="min-w-0 space-y-5">
          <div>
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <Badge variant={status === "proposed" ? "secondary" : "outline"}>{proposalStatusLabel(status)}</Badge>
              <span className="text-xs text-muted-foreground">
                {classificationLabel(recordText(proposal, "classification"))}
              </span>
            </div>
            <h3 className="text-base font-semibold text-foreground">{payloadTitle(proposal)}</h3>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">{recordText(proposal, "reason")}</p>
          </div>

          <div>
            <label className="mb-2 block text-xs font-medium text-muted-foreground" htmlFor="brand-project-edited-after">
              {t("brand_project.review_content")}
            </label>
            <Textarea
              id="brand-project-edited-after"
              value={editedAfter}
              onChange={(event) => setEditedAfter(event.target.value)}
              disabled={status !== "proposed" || busyAction !== null}
              className="min-h-36 resize-y font-mono text-xs leading-5"
            />
          </div>

          <div>
            <label className="mb-2 block text-xs font-medium text-muted-foreground" htmlFor="brand-project-review-reason">
              {t("brand_project.review_reason")}
            </label>
            <Textarea
              id="brand-project-review-reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              disabled={status !== "proposed" || busyAction !== null}
              placeholder={t("brand_project.review_reason_placeholder")}
              className="min-h-20"
            />
          </div>

          {error ? (
            <div className="flex items-start gap-2 border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive" role="alert">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              <span>{error}</span>
            </div>
          ) : null}

          {notice ? (
            <div
              className="flex items-start gap-2 border border-border bg-muted/30 px-3 py-2 text-sm text-muted-foreground"
              role="status"
              data-testid="brand-project-review-cancelled"
            >
              <ShieldCheck className="mt-0.5 size-4 shrink-0" />
              <span>{notice}</span>
            </div>
          ) : null}

          {status === "proposed" ? (
            <div className="flex flex-wrap gap-2">
              <Button data-testid="brand-project-review-approve" onClick={() => void review("approve")} disabled={busyAction !== null || !reason.trim()}>
                <Check className="size-4" />
                {t("brand_project.approve")}
              </Button>
              <Button data-testid="brand-project-review-modify" variant="secondary" onClick={() => void review("modify_and_approve")} disabled={busyAction !== null || !reason.trim()}>
                {t("brand_project.modify_approve")}
              </Button>
              <Button data-testid="brand-project-review-reject" variant="outline" onClick={() => void review("reject")} disabled={busyAction !== null || !reason.trim()}>
                <X className="size-4" />
                {t("brand_project.reject")}
              </Button>
            </div>
          ) : null}
        </div>

        <div className="min-w-0 border-l-0 border-border lg:border-l lg:pl-6">
          <SectionHeading title={t("brand_project.evidence")} count={evidenceRefs.length} />
          {evidenceRefs.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("brand_project.empty_evidence")}</p>
          ) : (
            <div className="space-y-1">
              {evidenceRefs.map((evidenceRef) => (
                <button
                  key={evidenceRef}
                  type="button"
                  data-evidence-ref={evidenceRef}
                  className="flex w-full items-center justify-between gap-3 border-b border-border px-1 py-2 text-left text-xs text-foreground hover:bg-muted/40"
                  onClick={() => void openEvidence(evidenceRef)}
                  disabled={evidenceBusy}
                >
                  <span className="min-w-0 truncate font-mono">{evidenceRef}</span>
                  <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
                </button>
              ))}
            </div>
          )}
          {evidence ? (
            <div className="mt-5 space-y-3 border-t border-border pt-4 text-sm">
              <div className="flex items-center justify-between gap-3">
                <span className="font-medium text-foreground">{recordText(evidence, "message")}</span>
                <Badge variant={recordText(evidence, "verification") === "confirmed" ? "secondary" : "destructive"}>
                  {recordText(evidence, "verification") === "confirmed"
                    ? t("brand_project.evidence_confirmed")
                    : t("brand_project.evidence_unconfirmed")}
                </Badge>
              </div>
              {recordText(evidence, "quote") ? (
                <blockquote className="border-l-2 border-border pl-3 leading-6 text-foreground">
                  {recordText(evidence, "quote")}
                </blockquote>
              ) : null}
              <p className="break-words text-xs text-muted-foreground">
                {recordText(evidence, "locator", "evidence_ref")}
              </p>
              {recordObject(evidence, "source") ? (
                <p className="break-words text-xs text-muted-foreground">
                  {recordText(recordObject(evidence, "source") ?? {}, "relative_path")}
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function ProposalsTab({ view, onReload }: { view: BrandProjectView; onReload: () => Promise<void> }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = view.proposals.find((proposal) => recordText(proposal, "proposal_id") === selectedId) ?? null;
  if (view.proposals.length === 0) return <EmptyRows message={t("brand_project.empty_proposals")} />;
  return (
    <div className="space-y-6 py-4">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("brand_project.change")}</TableHead>
            <TableHead>{t("brand_project.change_type")}</TableHead>
            <TableHead>{t("brand_project.status")}</TableHead>
            <TableHead className="w-12"><span className="sr-only">{t("brand_project.open_change")}</span></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {view.proposals.map((proposal) => {
            const proposalId = recordText(proposal, "proposal_id");
            return (
              <TableRow key={proposalId} data-proposal-id={proposalId} data-state={proposalId === selectedId ? "selected" : undefined}>
                <TableCell className="max-w-[520px] whitespace-normal font-medium">{payloadTitle(proposal)}</TableCell>
                <TableCell>{classificationLabel(recordText(proposal, "classification"))}</TableCell>
                <TableCell>{proposalStatusLabel(recordText(proposal, "status"))}</TableCell>
                <TableCell>
                  <Button variant="ghost" size="icon-sm" title={t("brand_project.open_change")} aria-label={t("brand_project.open_change")} onClick={() => setSelectedId(proposalId)}>
                    <ChevronRight className="size-4" />
                  </Button>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      {selected ? <ProposalDetail proposal={selected} stateVersion={view.project.stateVersion} onReviewed={onReload} /> : null}
    </div>
  );
}

function TasksTab({ view, onStartAiTask }: { view: BrandProjectView; onStartAiTask?: (prompt: string) => void }) {
  const [selectedPacket, setSelectedPacket] = useState<BrandProjectRecord | null>(null);
  const [busyPacketId, setBusyPacketId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const latestPacketByTask = useMemo(() => {
    const values = new Map<string, BrandProjectRecord>();
    for (const packet of view.taskPackets) {
      const taskId = recordText(packet, "task_id");
      if (taskId && !values.has(taskId)) values.set(taskId, packet);
    }
    return values;
  }, [view.taskPackets]);

  const loadPacket = async (packetId: string): Promise<BrandProjectRecord | null> => {
    setBusyPacketId(packetId);
    setError(null);
    try {
      const packet = await getBrandProjectTaskPacket(packetId);
      setSelectedPacket(packet);
      return packet;
    } catch (nextError) {
      setError(errorMessage(nextError));
      return null;
    } finally {
      setBusyPacketId(null);
    }
  };

  const startAiTask = async (packetId: string) => {
    try {
      const packet = await loadPacket(packetId);
      if (packet) onStartAiTask?.(taskPacketPrompt(packet));
    } catch (nextError) {
      setError(errorMessage(nextError));
    }
  };

  if (view.runtimeTasks.length === 0) return <EmptyRows message={t("brand_project.empty_tasks")} />;
  return (
    <div className="space-y-6 py-4">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("brand_project.task")}</TableHead>
            <TableHead>{t("brand_project.role")}</TableHead>
            <TableHead>{t("brand_project.mode")}</TableHead>
            <TableHead>{t("brand_project.updated")}</TableHead>
            <TableHead className="text-right">{t("brand_project.actions")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {view.runtimeTasks.map((task) => {
            const taskId = recordText(task, "task_id");
            const spec = recordObject(task, "spec");
            const packet = latestPacketByTask.get(taskId);
            const packetId = packet ? recordText(packet, "packet_id") : "";
            return (
              <TableRow key={taskId} data-task-id={taskId}>
                <TableCell className="max-w-[420px] whitespace-normal font-medium">
                  {spec ? recordText(spec, "goal") : taskId}
                </TableCell>
                <TableCell>{roleLabel(recordText(task, "role"))}</TableCell>
                <TableCell><Badge variant="outline">{modeLabel(recordText(task, "work_mode"))}</Badge></TableCell>
                <TableCell>{formatDate(task.updated_at)}</TableCell>
                <TableCell>
                  <div className="flex justify-end gap-1">
                    <Button data-testid="brand-project-view-packet" variant="ghost" size="sm" disabled={!packetId || busyPacketId !== null} onClick={() => void loadPacket(packetId)}>
                      <FileSearch className="size-4" />
                      {t("brand_project.view_task_context")}
                    </Button>
                    <Button data-testid="brand-project-start-ai" size="sm" disabled={!packetId || busyPacketId !== null || !onStartAiTask} onClick={() => void startAiTask(packetId)}>
                      <Play className="size-4" />
                      {t("brand_project.start_ai")}
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      {error ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}
      {selectedPacket ? (
        <section className="border-t border-border pt-5">
          <SectionHeading title={t("brand_project.task_context")} />
          <div className="grid gap-4 text-sm md:grid-cols-3">
            <div>
              <div className="text-xs text-muted-foreground">{t("brand_project.task_goal")}</div>
              <div className="mt-1 text-foreground">{payloadTitle(recordObject(selectedPacket, "task") ?? selectedPacket)}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">{t("brand_project.mode")}</div>
              <div className="mt-1 text-foreground">
                {modeLabel(recordText(recordObject(selectedPacket, "mode_contract") ?? {}, "mode", "work_mode"))}
              </div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">{t("brand_project.version_check")}</div>
              <div className="mt-1 break-all font-mono text-xs text-foreground">{recordText(selectedPacket, "content_hash")}</div>
            </div>
          </div>
        </section>
      ) : null}
    </div>
  );
}

export function BrandProjectWorkspace({ onStartAiTask }: BrandProjectWorkspaceProps) {
  const [view, setView] = useState<BrandProjectView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState("overview");

  const load = useCallback(async () => {
    const startedAt = Date.now();
    setLoading(true);
    setError(null);
    try {
      const status = await getBrandProjectStatus();
      if (!status.configured) {
        throw new Error(status.message || t("brand_project.not_connected"));
      }
      setView(await getBrandProjectView());
    } catch (nextError) {
      setView(null);
      setError(errorMessage(nextError));
    } finally {
      const remaining = MINIMUM_LOAD_VISIBLE_MS - (Date.now() - startedAt);
      if (remaining > 0) await new Promise((resolve) => setTimeout(resolve, remaining));
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center" role="status" data-testid="brand-project-loading">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <RefreshCw className="size-4 animate-spin" />
          {t("brand_project.loading")}
        </div>
      </div>
    );
  }

  if (!view) {
    return (
      <div className="flex h-full items-center justify-center px-6" data-testid="brand-project-error">
        <div className="w-full max-w-lg border border-border bg-background p-6 text-center">
          <AlertTriangle className="mx-auto size-5 text-amber-500" />
          <h2 className="mt-3 text-base font-semibold text-foreground">{t("brand_project.unavailable")}</h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">{error}</p>
          <Button data-testid="brand-project-retry" variant="outline" className="mt-5" onClick={() => void load()}>
            <RefreshCw className="size-4" />
            {t("common.refresh")}
          </Button>
        </div>
      </div>
    );
  }

  const metrics = [
    [t("brand_project.metric_state"), view.summary.currentStateCount],
    [t("brand_project.metric_sources"), view.summary.currentSourceCount],
    [t("brand_project.metric_gaps"), view.summary.knownGapCount],
    [t("brand_project.metric_pending"), view.summary.pendingProposalCount],
  ];

  return (
    <div className="h-full overflow-y-auto bg-background" data-testid="brand-project-workspace">
      <div className="mx-auto w-full max-w-[1280px] px-5 py-6 md:px-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
              <FolderKanban className="size-4" />
              {t("brand_project.workspace")}
            </div>
            <h2 className="mt-2 text-xl font-semibold text-foreground">{view.project.name}</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              {t("brand_project.state_version", { version: view.project.stateVersion })}
              <span className="px-2">·</span>
              {t("brand_project.updated_at", { time: formatDate(view.project.updatedAt) })}
            </p>
            <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground" data-testid="brand-project-approval-boundary">
              <ShieldCheck className="size-3.5" />
              {t("brand_project.approval_boundary", { actor: view.authority.approvalActor })}
            </p>
          </div>
          <Button data-testid="brand-project-refresh" variant="ghost" size="icon-sm" title={t("common.refresh")} aria-label={t("common.refresh")} onClick={() => void load()}>
            <RefreshCw className="size-4" />
          </Button>
        </div>

        <div className="mt-6 grid border-y border-border sm:grid-cols-2 lg:grid-cols-4">
          {metrics.map(([label, value], index) => (
            <div key={String(label)} data-testid={`brand-project-metric-${["state", "sources", "gaps", "pending"][index]}`} className={`px-4 py-4 ${index > 0 ? "sm:border-l sm:border-border" : ""}`}>
              <div className="text-xs text-muted-foreground">{label}</div>
              <div className="mt-1 text-2xl font-semibold text-foreground">{value}</div>
            </div>
          ))}
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="mt-6">
          <TabsList variant="line" className="w-full justify-start border-b border-border">
            <TabsTrigger value="overview" data-testid="brand-project-tab-overview"><ListChecks className="size-4" />{t("brand_project.tab_overview")}</TabsTrigger>
            <TabsTrigger value="sources" data-testid="brand-project-tab-sources"><FileSearch className="size-4" />{t("brand_project.tab_sources")}</TabsTrigger>
            <TabsTrigger value="proposals" data-testid="brand-project-tab-proposals"><AlertTriangle className="size-4" />{t("brand_project.tab_proposals")}</TabsTrigger>
            <TabsTrigger value="tasks" data-testid="brand-project-tab-tasks"><Play className="size-4" />{t("brand_project.tab_tasks")}</TabsTrigger>
          </TabsList>
          <TabsContent value="overview"><OverviewTab view={view} /></TabsContent>
          <TabsContent value="sources"><SourcesTab view={view} /></TabsContent>
          <TabsContent value="proposals"><ProposalsTab view={view} onReload={load} /></TabsContent>
          <TabsContent value="tasks"><TasksTab view={view} onStartAiTask={onStartAiTask} /></TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
