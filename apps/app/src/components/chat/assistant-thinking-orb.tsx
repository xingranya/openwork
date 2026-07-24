import { ThinkingOrb } from "thinking-orbs"

export function AssistantThinkingOrb() {
  return (
    <ThinkingOrb
      state="working"
      size={20}
      theme="auto"
      role="presentation"
      aria-label=""
      className="shrink-0"
      data-testid="assistant-thinking-orb"
    />
  )
}
