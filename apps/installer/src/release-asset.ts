const GITHUB_REPO = "xingranya/openwork"

function usesSeeWayWorkBrand(version: string): boolean {
  const [major = 0, minor = 0, patch = 0] = version
    .split(/[.-]/, 3)
    .map((part) => Number.parseInt(part, 10) || 0)
  if (major !== 0) return major > 0
  if (minor !== 18) return minor > 18
  return patch >= 4
}

export type ReleaseAsset = {
  version: string
  fileName: string
  url: string
  type: "dmg" | "exe" | "appimage"
}

/**
 * 0.18.4 起使用 SeeWayWork 发行资产；更早版本只作为升级与回滚兼容。
 */
export function releaseAssetFor(
  version: string,
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
): ReleaseAsset {
  const normalized = version.trim().replace(/^v/i, "")
  if (!normalized) throw new Error("version is required")
  if (arch !== "arm64" && arch !== "x64") {
    throw new Error(`unsupported architecture: ${arch}`)
  }

  const useSeeWayWorkBrand = usesSeeWayWorkBrand(normalized)
  const assetPrefix = useSeeWayWorkBrand ? "SeeWayWork" : "foxwork"
  const releaseTag = `${useSeeWayWorkBrand ? "seewaywork" : "foxwork"}-v${normalized}`

  const build = (fileName: string, type: ReleaseAsset["type"]): ReleaseAsset => ({
    version: normalized,
    fileName,
    type,
    url: `https://github.com/${GITHUB_REPO}/releases/download/${releaseTag}/${encodeURIComponent(fileName)}`,
  })

  if (platform === "darwin") {
    return build(`${assetPrefix}-mac-${arch}-${normalized}.dmg`, "dmg")
  }
  if (platform === "win32") {
    if (arch !== "x64") throw new Error(`unsupported Windows architecture: ${arch}`)
    return build(`${assetPrefix}-win-x64-${normalized}.exe`, "exe")
  }
  if (platform === "linux") {
    // The AppImage uses x86_64 in its name while the tarball uses x64.
    const appImageArch = arch === "x64" ? "x86_64" : "arm64"
    return build(`${assetPrefix}-linux-${appImageArch}-${normalized}.AppImage`, "appimage")
  }
  throw new Error(`unsupported platform: ${platform}`)
}
