import { ArrowLeftIcon, CheckIcon, WarningIcon } from "@phosphor-icons/react";
import JsonMonacoEditor from "~/components/admin/JsonMonacoEditor";
import { Button } from "@radix-ui/themes";

export interface JsonSourcePanelProps {
    value: string;
    issues: string[];
    onChange: (value: string) => void;
    onApply: () => void;
    onBack: () => void;
}

export function JsonSourcePanel({ value, issues, onChange, onApply, onBack }: JsonSourcePanelProps) {
    return (
        <div className="flex h-full w-full flex-col" style={{ background: "var(--color-editor-bg)" }}>
            <div className="flex h-[60px] shrink-0 items-center justify-between px-2">
                <button
                    type="button"
                    onClick={onBack}
                    className="flex h-[34px] items-center gap-2 rounded-lg px-2 text-[13px] text-white/75 transition hover:bg-white/10 hover:text-white"
                >
                    <ArrowLeftIcon size={16} weight="regular" />
                    返回可视化编辑
                </button>
                <Button
                    size="2"
                    radius="medium"
                    variant="soft"
                    onClick={onApply}
                    disabled={issues.length > 0}
                    style={{
                        height: "var(--editor-control-height)",
                        borderRadius: "var(--editor-control-radius)",
                    }}
                >
                    <CheckIcon size={14} weight="regular" />
                    应用
                </Button>
            </div>
            <div style={{ height: "var(--editor-divider-width)", background: "var(--color-editor-divider)" }} />
            {issues.length > 0 && (
                <div className="shrink-0 border-b border-red-400/30 bg-red-400/10 px-3 py-2">
                    <p className="flex items-center gap-1.5 text-xs font-medium text-red-300">
                        <WarningIcon size={13} weight="regular" />
                        配置存在 {issues.length} 处问题
                    </p>
                    <ul className="mt-1 list-disc pl-5 text-[11px] leading-4 text-red-200/80">
                        {issues.slice(0, 8).map((issue, index) => (
                            <li key={index}>{issue}</li>
                        ))}
                        {issues.length > 8 && <li>… 其余 {issues.length - 8} 条</li>}
                    </ul>
                </div>
            )}
            <div className="min-h-0 flex-1">
                <JsonMonacoEditor value={value} onChange={onChange} height="100%" />
            </div>
        </div>
    );
}
