import { Button, TextField } from "@radix-ui/themes";
import type { RepoInfo } from "~/logic/publish/submission";
import { Field, SectionCard } from "./shared";

interface RepoStepSectionProps {
    repoNameInput: string;
    repoStatus: "idle" | "loading" | "success" | "error";
    repoMessage: string;
    repoInfo: RepoInfo | null;
    uploadLogs: string[];
    onRepoNameChange: (value: string) => void;
    onUpload: () => void;
    onPrev: () => void;
    onNext: () => void;
    mode?: "new" | "edit";
}

export function RepoStepSection({
    repoNameInput,
    repoStatus,
    repoMessage,
    repoInfo,
    uploadLogs,
    onRepoNameChange,
    onUpload,
    onPrev,
    onNext,
    mode = "new",
}: RepoStepSectionProps) {
    const isEdit = mode === "edit";
    return (
        <SectionCard
            title={isEdit ? "步骤 2 · 更新发布仓库" : "步骤 2 · 创建发布仓库并上传"}
            description={
                isEdit
                    ? "更新已有仓库中的 manifest_v2.json 与资源文件。"
                    : "会在你的 GitHub 账号下创建仓库，上传 manifest_v2.json 与所有依赖文件。"
            }
        >
            <div className="flex flex-col gap-2">
                <Field label="仓库名称">
                    <TextField.Root
                        placeholder="留空时根据 ID 自动生成"
                        value={repoNameInput}
                        onChange={(e) => onRepoNameChange(e.target.value)}
                    />
                </Field>
                <div className="flex flex-wrap items-center gap-2">
                    <Button
                        className="styledbtn"
                        onClick={onUpload}
                        disabled={repoStatus === "loading"}
                    >
                        {repoStatus === "loading"
                            ? "处理中..."
                            : isEdit
                              ? "更新并上传"
                              : "创建并上传"}
                    </Button>
                    {repoStatus === "success" && repoInfo?.htmlUrl && (
                        <a
                            className="text-sm text-emerald-300 underline"
                            href={repoInfo.htmlUrl}
                            target="_blank"
                            rel="noreferrer"
                        >
                            查看仓库
                        </a>
                    )}
                    {repoMessage && (
                        <p
                            className={`text-sm ${repoStatus === "error" ? "text-amber-400" : "text-white/70"}`}
                        >
                            {repoMessage}
                        </p>
                    )}
                </div>
                <div className="max-h-48 overflow-auto rounded-lg border border-white/10 bg-black/30 p-3 text-xs text-white/70">
                    {uploadLogs.length === 0 ? (
                        <p className="text-white/50">等待执行...</p>
                    ) : (
                        uploadLogs.map((log, idx) => <p key={idx}>{log}</p>)
                    )}
                </div>
            </div>
            <div className="flex flex-row justify-between gap-2 pt-2">
                <Button className="styledbtn" onClick={onPrev}>
                    返回上一步
                </Button>
                <Button className="styledbtn" onClick={onNext}>
                    下一步：提交 PR
                </Button>
            </div>
        </SectionCard>
    );
}
