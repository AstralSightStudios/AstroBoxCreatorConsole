import { useCallback, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { WallpaperEditor } from "~/components/wallpaper-editor/WallpaperEditor";
import { WallpaperEditorErrorBoundary } from "~/components/wallpaper-editor/ErrorBoundary";
import type { ResourceEditContext } from "~/logic/publish/resources";
import {
    updateWizardWallpaperPayload,
    type WizardWallpaperResult,
} from "~/logic/wallpaper/wizard-session";
import type { WallpaperAssetFile, WallpaperConfigRaw } from "~/logic/wallpaper/types";

interface EditorPageState {
    wallpaperInitial?: {
        config: WallpaperConfigRaw;
        assets: WallpaperAssetFile[];
        baseUrl: string;
    } | null;
    title?: string;
    returnPath?: string;
    editContext?: ResourceEditContext | null;
}

export default function WallpaperEditorPage() {
    const location = useLocation();
    const navigate = useNavigate();
    const state = (location.state as EditorPageState | null) ?? {};
    const [payload, setPayload] = useState<{
        configJson: string;
        assets: WallpaperAssetFile[];
    }>({ configJson: "", assets: [] });

    const handleBack = useCallback(() => {
        let config: WallpaperConfigRaw | undefined;
        if (payload.configJson.trim()) {
            try {
                config = JSON.parse(payload.configJson) as WallpaperConfigRaw;
            } catch {
                config = undefined;
            }
        }
        const result: WizardWallpaperResult | undefined = config
            ? {
                  configJson: payload.configJson,
                  assets: payload.assets,
                  config,
                  baseUrl: state.wallpaperInitial?.baseUrl ?? "",
              }
            : undefined;
        navigate(state.returnPath ?? "/publish/new", {
            state: {
                wallpaperResult: result,
                editContext: state.editContext ?? null,
            },
        });
    }, [navigate, payload, state]);

    const handleEditorChange = useCallback((next: {
        configJson: string;
        assets: WallpaperAssetFile[];
    }) => {
        setPayload(next);
        updateWizardWallpaperPayload(next);
    }, []);

    return (
        <div className="h-full min-h-0 w-full overflow-hidden">
            <WallpaperEditorErrorBoundary
                onReset={() => {
                    navigate(state.returnPath ?? "/publish/new", {
                        state: { editContext: state.editContext ?? null },
                    });
                }}
            >
                <WallpaperEditor
                    title={state.title ?? ""}
                    initialConfig={state.wallpaperInitial?.config}
                    initialAssets={state.wallpaperInitial?.assets}
                    baseUrl={state.wallpaperInitial?.baseUrl}
                    onBack={handleBack}
                    onChange={handleEditorChange}
                />
            </WallpaperEditorErrorBoundary>
        </div>
    );
}
