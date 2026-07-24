/** @jsxImportSource react */
import { isDesktopRuntime } from "@/app/utils";
import { Separator } from "@/components/ui/separator";
import { ThemeSection } from "../appearance/theme-section";
import { WindowSection } from "../appearance/window-section";
import { LayoutStack } from "../settings-layout";

export type AppearanceViewProps = {
  busy: boolean;
  themeMode: "light" | "dark" | "system";
  setThemeMode: (value: "light" | "dark" | "system") => void;
  hideTitlebar: boolean;
  toggleHideTitlebar: () => void;
};

export function AppearanceView(props: AppearanceViewProps) {
  return (
    <LayoutStack>
      <ThemeSection {...props} />
      {isDesktopRuntime() ? (
        <>
          <Separator />
          <WindowSection {...props} />
        </>
      ) : null}
    </LayoutStack>
  );
}
