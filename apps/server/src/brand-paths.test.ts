import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  migrateLegacyDirectory,
  resolveBrandConfigDirectory,
  resolveBrandDataDirectory,
  resolveLegacyConfigDirectory,
} from "./brand-paths.js";

describe("Brand Project OS data paths", () => {
  test("uses brand-owned config and data directories", () => {
    const options = { environment: {}, currentPlatform: "darwin" as const, homeDirectory: "/Users/test" };
    expect(resolveBrandConfigDirectory(options)).toBe("/Users/test/.config/brand-project-os");
    expect(resolveLegacyConfigDirectory(options)).toBe("/Users/test/.config/openwork");
    expect(resolveBrandDataDirectory(options)).toBe("/Users/test/.brand-project-os");
  });

  test("honors XDG_CONFIG_HOME and Windows APPDATA", () => {
    expect(resolveBrandConfigDirectory({
      environment: { XDG_CONFIG_HOME: "/tmp/xdg" },
      currentPlatform: "linux",
      homeDirectory: "/home/test",
    })).toBe("/tmp/xdg/brand-project-os");
    expect(resolveBrandConfigDirectory({
      environment: { APPDATA: "C:\\Users\\test\\AppData\\Roaming" },
      currentPlatform: "win32",
      homeDirectory: "C:\\Users\\test",
    })).toContain("brand-project-os");
  });

  test("migrates missing files without changing legacy data", async () => {
    const root = await mkdtemp(join(tmpdir(), "brand-project-os-server-migration-"));
    const legacy = join(root, "openwork");
    const current = join(root, "brand-project-os");
    await mkdir(legacy, { recursive: true });
    await mkdir(current, { recursive: true });
    await writeFile(join(legacy, "server.json"), "legacy", "utf8");
    await writeFile(join(legacy, "env.json"), "legacy-env", "utf8");
    await writeFile(join(current, "env.json"), "current-env", "utf8");

    expect(await migrateLegacyDirectory(legacy, current)).toBe(1);
    expect(await readFile(join(current, "server.json"), "utf8")).toBe("legacy");
    expect(await readFile(join(current, "env.json"), "utf8")).toBe("current-env");
    expect(await readFile(join(legacy, "env.json"), "utf8")).toBe("legacy-env");
  });
});
