export function appendAttachmentTokensToDraft(draft: string, attachmentIds: readonly string[]) {
  const tokens = attachmentIds
    .map((id) => id.trim())
    .filter(Boolean)
    .map((id) => `[attachment ${id}]`)
    .join("");
  if (!tokens) return draft;
  const separator = draft.length > 0 && !/\s$/.test(draft) ? " " : "";
  return `${draft}${separator}${tokens} `;
}
