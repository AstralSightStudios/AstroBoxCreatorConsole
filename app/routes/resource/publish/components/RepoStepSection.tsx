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
      title={isEdit ? "更新发布仓库" : "创建发布仓库并上传"}
      description={
        isEdit
          ? "更新已有仓库中的 manifest_v2.json 与资源文件。"
          : "自动在你的 GitHub 账号下创建仓库并上传 manifest_v2.json 与所有资源文件。"
      }
      className="p-0!"
      padding={false}
    >
      <div className="flex flex-col gap-2 p-2">
        <Field label="仓库名称">
          <TextField.Root
            placeholder="留空时根据 ID 自动生成"
            value={repoNameInput}
            onChange={(e) => onRepoNameChange(e.target.value)}
            radius="large"
          />
        </Field>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            className="text-sm! lg:max-h-10! max-lg:min-h-12! max-lg:w-full!"
            radius="large"
            size="2"
            variant="soft"
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
              className="rt-reset rt-BaseButton rt-r-size-2 rt-variant-soft rt-Button text-sm! lg:max-h-10! max-lg:min-h-12! max-lg:w-full!"
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
      </div>
      <div>
        <div className="max-h-48 overflow-auto bg-black/25 border-t border-white/10 p-2.5 text-xs text-white/70">
          {uploadLogs.length === 0 ? (
            <p className="text-white/50">等待执行...</p>
          ) : (
            uploadLogs.map((log, idx) => <p key={idx}>{log}</p>)
          )}
        </div>
        <div className="flex flex-row max-lg:flex-col justify-between gap-2 p-2 bg-black/25 border-t border-white/10 rounded-b-[14px]">
          <Button
            className="text-sm! lg:max-h-10! max-lg:min-h-12! max-lg:w-full!"
            radius="large"
            size="2"
            variant="soft"
            color="gray"
            onClick={onPrev}
          >
            上一步
          </Button>
          <Button
            className="text-sm! lg:max-h-10! max-lg:min-h-12! max-lg:w-full!"
            radius="large"
            size="2"
            variant="soft"
            onClick={onNext}
          >
            下一步
          </Button>
        </div>
      </div>
    </SectionCard>
  );
}
