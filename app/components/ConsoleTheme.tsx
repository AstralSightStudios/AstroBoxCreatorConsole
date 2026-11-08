import { Theme } from "@radix-ui/themes";
import type { ReactNode } from "react";

/**
 * 与 root.tsx 的根 Theme 保持一致。
 * 抽屉/对话框等浮层 portal 到 .ui-scale-portal-host，不在根 Theme 的 DOM 子树内，
 * 必须单独套一层 Theme，否则会落到 :root 的浅色 token 上。
 */
export const CONSOLE_THEME_PROPS = {
    appearance: "dark" as const,
    accentColor: "blue" as const,
    radius: "medium" as const,
    panelBackground: "translucent" as const,
};

export function ConsoleThemeScope({ children }: { children: ReactNode }) {
    return (
        <Theme {...CONSOLE_THEME_PROPS} style={{ display: "contents" }}>
            {children}
        </Theme>
    );
}
