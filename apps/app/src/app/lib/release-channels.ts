/**
 * Release-channel concept for OpenWork desktop builds.
 *
 * There are two channels users can opt into:
 *
 * - "stable": the default channel name. It remains offline until an
 *   administrator configures a stable updater endpoint.
 *
 * - "alpha": a macOS-only channel that also requires an administrator-
 *   configured endpoint.
 *
 * Only the macOS (arm64) build is published to the alpha channel today.
 * Linux and Windows always resolve to the stable channel.
 */

import type { ReleaseChannel } from "../types";

/** Explicitly configured stable updater manifest URL. */
export const STABLE_UPDATER_ENDPOINT =
  String(import.meta.env.VITE_OPENWORK_UPDATER_STABLE_ENDPOINT ?? "").trim();

/** Explicitly configured alpha updater manifest URL (macOS-only). */
export const ALPHA_UPDATER_ENDPOINT =
  String(import.meta.env.VITE_OPENWORK_UPDATER_ALPHA_ENDPOINT ?? "").trim();

/** Rolling GitHub release tag that alpha macOS artifacts are published to. */
export const ALPHA_MACOS_RELEASE_TAG = "alpha-macos-latest";

export type PlatformKind = "darwin" | "linux" | "windows" | "web" | "unknown";

/**
 * Returns true when the given platform supports the alpha channel.
 *
 * Today alpha builds are produced only for macOS (arm64). The type-level
 * conservatism here is deliberate: it's easier to widen later than to
 * silently start advertising an alpha endpoint that serves no artifact.
 */
export function isAlphaChannelSupported(platform: PlatformKind): boolean {
  return platform === "darwin";
}

/**
 * Resolve the Tauri updater manifest URL for the requested channel.
 *
 * Falls back to the stable endpoint whenever alpha isn't supported on the
 * current platform, so the caller never needs to special-case "alpha chosen
 * on Linux" / "alpha chosen on Windows" etc.
 */
export function resolveUpdaterEndpoint(
  channel: ReleaseChannel,
  platform: PlatformKind = "darwin",
): string {
  if (channel === "alpha" && isAlphaChannelSupported(platform)) {
    return ALPHA_UPDATER_ENDPOINT;
  }
  return STABLE_UPDATER_ENDPOINT;
}

/** Narrow an arbitrary string to a valid ReleaseChannel, defaulting to stable. */
export function coerceReleaseChannel(value: unknown): ReleaseChannel {
  return value === "alpha" ? "alpha" : "stable";
}
