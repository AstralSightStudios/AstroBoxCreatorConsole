import { Button, Checkbox, TextArea, TextField } from "@radix-ui/themes";
import { PUBLISH_CONFIG } from "~/config/publish";
import { MAIN_RESOURCE_BRANCH } from "~/logic/publish/branch";
import type { VersionResetOptions } from "~/logic/publish/version-reset";
import { SectionCard } from "./shared";

interface PrStepSectionProps {
  prBody: string;
  prStatus: "idle" | "loading" | "success" | "error";
  prMessage: string;
  onPrBodyChange: (value: string) => void;
  onSubmit: () => void;
  onBack: () => void;
  mode?: "new" | "update" | "reopen";
  needFixItems?: Array<{ id: string; message: string }>;
  fixedSelections?: Record<string, boolean>;
  fixedNotes?: Record<string, string>;
  onFixedToggle?: (id: string) => void;
  onFixedNoteChange?: (id: string, value: string) => void;
  /** 已上架资源推送新版本时才传：可选清空评分 / 折叠既往评论。 */
  versionReset?: VersionResetOptions;
  onVersionResetChange?: (next: VersionResetOptions) => void;
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
  versionReset,
  onVersionResetChange,
}: PrStepSectionProps) {
  const isReopen = mode === "reopen";
  const isUpdate = mode === "update" || isReopen;
  return (
    <SectionCard
      title={
        isReopen
          ? "步骤 3 · 重新打开并提交 PR"
          : isUpdate
            ? "步骤 3 · 更新 Pull Request"
            : "步骤 3 · 提交 Pull Request"
      }
      description={
        isReopen
          ? `重新打开已关闭的 PR，并将最新修改推送至 ${PUBLISH_CONFIG.targetPrRepoOwner}/${PUBLISH_CONFIG.targetPrRepoName} 的现有 PR。`
          : isUpdate
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
        {versionReset && onVersionResetChange && (
          <div className="flex flex-col gap-2 rounded-lg border border-white/10 bg-white/[0.03] p-2.5">
            <p className="text-sm font-semibold text-white/85">新版本选项（可选）</p>
            <label className="flex items-start gap-2 text-sm text-white/85">
              <Checkbox
                checked={versionReset.resetRatings}
                onCheckedChange={(checked) =>
                  onVersionResetChange({ ...versionReset, resetRatings: checked === true })
                }
              />
              <span className="min-w-0">
                清空资源评分
                <span className="block text-xs text-white/55">
                  此前的评分不再计入，所有用户都可以重新评分。旧评分会被归档，无法自行恢复。
                </span>
              </span>
            </label>
            <label className="flex items-start gap-2 text-sm text-white/85">
              <Checkbox
                checked={versionReset.foldComments}
                onCheckedChange={(checked) =>
                  onVersionResetChange({ ...versionReset, foldComments: checked === true })
                }
              />
              <span className="min-w-0">
                折叠既往的全部评论
                <span className="block text-xs text-white/55">
                  评论不会被删除，用户仍可在「折叠的评论」中查看，并会标明由资源发布者主动折叠。
                </span>
              </span>
            </label>
            <p className="text-xs text-white/55">
              审核通过、新版本上线后由服务端执行，每个版本只执行一次；本次更新如果没有修改版本号则不会执行。
            </p>
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
            ? isReopen
              ? "重新打开并提交中..."
              : isUpdate
                ? "更新中..."
                : "创建中..."
            : isReopen
              ? "重新打开并提交"
              : isUpdate
                ? "更新"
                : "提交"}
        </Button>
      </div>
    </SectionCard>
  );
}
