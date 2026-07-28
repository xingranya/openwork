/** @jsxImportSource react */
import { AlertCircle, LoaderCircle } from "lucide-react";

import { WorkspaceIcon } from "../../design-system/workspace-icon";
import { cn } from "@/lib/utils";

export type PersonalRemoteWorkspaceUiState = {
  status: "provisioning" | "error";
  message: string;
};

export function PersonalRemoteWorkspaceStatusItem({
  state,
}: {
  state: PersonalRemoteWorkspaceUiState;
}) {
  const isError = state.status === "error";

  return (
    <div
      data-personal-remote-workspace-status={state.status}
      className="flex min-h-10 items-center gap-2 px-3 py-1.5 text-sm"
    >
      <span className="flex size-5 shrink-0 items-center justify-center">
        <WorkspaceIcon workspaceId="foxwork-company-personal-remote" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate">我的远程工作区</span>
        <span
          className={cn(
            "block truncate text-xs",
            isError ? "text-destructive" : "text-muted-foreground",
          )}
          title={state.message}
        >
          {state.message}
        </span>
      </span>
      {isError ? (
        <AlertCircle className="size-4 shrink-0 text-destructive" aria-hidden="true" />
      ) : (
        <LoaderCircle
          className="size-4 shrink-0 animate-spin text-muted-foreground"
          aria-label="正在准备公司远程工作区"
        />
      )}
    </div>
  );
}
