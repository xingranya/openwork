/** @jsxImportSource react */
import { MarbleAvatar } from "./marble-avatar";

export type WorkspaceIconProps = {
  workspaceId: string;
  sizeClass?: string;
};

export function WorkspaceIcon({ workspaceId, sizeClass = "size-4" }: WorkspaceIconProps) {
  return (
    <span
      data-workspace-icon
      className={`${sizeClass} shrink-0 overflow-hidden rounded-full`}
      aria-hidden="true"
    >
      <MarbleAvatar seed={workspaceId} className="size-full rounded-full" />
    </span>
  );
}
