import { Button, Checkbox, TextArea, TextField } from "@radix-ui/themes";
import { PUBLISH_CONFIG } from "~/config/publish";
import { MAIN_RESOURCE_BRANCH } from "~/logic/publish/branch";
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
  needFixItems?: Array<{ id: string; message: string }>;
  fixedSelections?: Record<string, boolean>;
  fixedNotes?: Record<string, string>;
  onFixedToggle?: (id: string) => void;
  onFixedNoteChange?: (id: string, value: string) => void;
}

export function PrStepSection({
  prBody,
  prStatus,
  prMessage,
  onPrBodyChange,
  onSubmit,
  onBack,
  mode = "new",
  needFixItems = [],
  fixedSelections = {},
  fixedNotes = {},
  onFixedToggle,
  onFixedNoteChange,
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
          : `将当前仓库的 ${MAIN_RESOURCE_BRANCH} 分支提交到 ${PUBLISH_CONFIG.targetPrRepoOwner}/${PUBLISH_CONFIG.targetPrRepoName}。`
      }
      className="gap-0!"
      padding={false}
    >
      <div className="flex flex-col gap-2 px-2">
        {needFixItems.length > 0 && (
          <div className="flex flex-col gap-2 rounded-lg border border-amber-400/25 bg-amber-400/5 p-2.5">
            <p className="text-sm font-semibold text-amber-200">
              本次更新已修复的问题
            </p>
            {needFixItems.map((item) => (
              <div key={item.id} className="flex flex-col gap-1.5">
                <label className="flex items-start gap-2 text-sm text-white/85">
                  <Checkbox
                    checked={Boolean(fixedSelections[item.id])}
                    onCheckedChange={() => onFixedToggle?.(item.id)}
                  />
                  <span className="min-w-0">
                    <span className="font-mono text-xs text-amber-300">
                      {item.id}
                    </span>
                    <span className="ml-2">{item.message || "（无附加说明）"}</span>
                  </span>
                </label>
                {fixedSelections[item.id] && (
                  <TextField.Root
                    placeholder="修复说明（可选）"
                    value={fixedNotes[item.id] || ""}
                    radius="large"
                    onChange={(e) => onFixedNoteChange?.(item.id, e.target.value)}
                  />
                )}
              </div>
            ))}
          </div>
        )}
        <TextArea
          rows={3}
          placeholder="可填写说明、变更摘要或备注"
          value={prBody}
          onChange={(e) => onPrBodyChange(e.target.value)}
          radius="large"
        />
        <p className="px-1.5 text-xs text-white/60">
          欢迎加入{" "}
          <a
            href="https://qm.qq.com/q/4YVntKbEMo"
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-400 hover:text-blue-300"
          >
            AstroBox 资源开发者官方 QQ 群
          </a>
        </p>
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
