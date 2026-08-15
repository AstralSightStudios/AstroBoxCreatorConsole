import { Component } from "react";
import type { ReactNode } from "react";

interface ErrorBoundaryProps {
    onReset?: () => void;
    children: ReactNode;
}

interface ErrorBoundaryState {
    error: Error | null;
}

/**
 * Prevents a single bad value in the wallpaper config from unmounting the whole
 * editor (or the entire app). Shows a recoverable error card instead.
 */
export class WallpaperEditorErrorBoundary extends Component<
    ErrorBoundaryProps,
    ErrorBoundaryState
> {
    state: ErrorBoundaryState = { error: null };

    static getDerivedStateFromError(error: Error): ErrorBoundaryState {
        return { error };
    }

    handleReset = () => {
        this.setState({ error: null });
        this.props.onReset?.();
    };

    render() {
        if (this.state.error) {
            return (
                <div
                    className="flex h-full w-full flex-col items-center justify-center gap-3 p-6 text-center"
                    style={{ background: "var(--color-editor-bg)" }}
                >
                    <p className="text-sm font-medium text-red-300">编辑器遇到异常</p>
                    <p className="max-w-md break-all text-xs leading-5 text-white/50">
                        {this.state.error.message || String(this.state.error)}
                    </p>
                    <p className="max-w-md text-xs leading-5 text-white/40">
                        可能是某个数值或配置不合法导致。你可以前往 JSON 页检查，或重置当前改动。
                    </p>
                    <div className="flex items-center gap-2">
                        <button
                            type="button"
                            onClick={this.handleReset}
                            className="rounded-md bg-[var(--color-editor-blue-bg)] px-3 py-1.5 text-sm text-[var(--color-editor-blue-fg)] transition hover:opacity-80"
                        >
                            重试
                        </button>
                    </div>
                </div>
            );
        }
        return this.props.children;
    }
}
