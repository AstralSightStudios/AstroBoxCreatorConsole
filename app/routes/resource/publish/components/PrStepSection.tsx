import { Button, TextArea } from "@radix-ui/themes";
import { PUBLISH_CONFIG } from "~/config/publish";
import { SectionCard } from "./shared";
import { GitPullRequestIcon } from "@phosphor-icons/react";

interface PrStepSectionProps {
  prBody: string;
  prStatus: "idle" | "loading" | "success" | "error";
  prMessage: string;
  onPrBodyChange: (value: string) => void;
  onSubmit: () => void;
  onBack: () => void;
  mode?: "new" | "update";
}

export function PrStepSection({
  prBody,
  prStatus,
  prMessage,
  onPrBodyChange,
  onSubmit,
  onBack,
  mode = "new",
}: PrStepSectionProps) {
  const isUpdate = mode === "update";
  return (
    <SectionCard
      title={
        isUpdate ? "步骤 3 · 更新 Pull Request" : "步骤 3 · 提交 Pull Request"
      }
      description={
        isUpdate
          ? `向 ${PUBLISH_CONFIG.targetPrRepoOwner}/${PUBLISH_CONFIG.targetPrRepoName} 的现有 PR 推送最新提交。`
          : `将当前仓库的 ${PUBLISH_CONFIG.defaultBranch} 分支提交到 ${PUBLISH_CONFIG.targetPrRepoOwner}/${PUBLISH_CONFIG.targetPrRepoName}。`
      }
      className="gap-0!"
      padding={false}
    >
      <div className="flex flex-col gap-2 px-2">
        <TextArea
          rows={3}
          placeholder="可填写说明、变更摘要或备注"
          value={prBody}
          onChange={(e) => onPrBodyChange(e.target.value)}
          radius="large"
        />
      </div>
      <div className="max-h-48 overflow-auto bg-black/25 border-t border-white/10 p-2.5 text-xs text-white/70 -mb-2.5 flex items-center gap-1">
        {prMessage && (
          <>
            <GitPullRequestIcon size={16} weight="bold" />
            <p
              className={`text-sm ${prStatus === "error" ? "text-amber-400" : "text-white/70"}`}
            >
              {prMessage}
            </p>
          </>
        )}
      </div>
      <div className="flex flex-row max-lg:flex-col justify-between gap-2 p-2 bg-black/25 border-t border-white/10 rounded-b-[14px]">
        <Button
          className="text-sm! lg:max-h-10! max-lg:min-h-12! max-lg:w-full!"
          radius="large"
          size="2"
          variant="soft"
          color="gray"
          onClick={onBack}
        >
          上一步
        </Button>
        <Button
          className="text-sm! lg:max-h-10! max-lg:min-h-12! max-lg:w-full!"
          radius="large"
          size="2"
          variant="soft"
          onClick={onSubmit}
          disabled={prStatus === "loading"}
        >
          {prStatus === "loading"
            ? isUpdate
              ? "更新中..."
              : "创建中..."
            : isUpdate
              ? "更新"
              : "提交"}
        </Button>
      </div>
    </SectionCard>
  );
}
