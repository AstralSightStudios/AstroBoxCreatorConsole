import { useState } from "react";
import { Button } from "@radix-ui/themes";
import { BookOpenText, ChatCenteredText, Sparkle } from "@phosphor-icons/react";
import type { GithubIssueComment, GithubPullFile, GithubPullRequest } from "~/api/github/pr-review";
import type { PrResourcePreview } from "../../types";
import { AiDraftDialog } from "./AiDraftDialog";
import { GuidelinePickerDialog } from "./GuidelinePicker";
import { PresetPickerDialog } from "./PresetPicker";

/** 审核辅助需要的上下文：正在审核的 PR 和它包含的资源。 */
export interface ReviewAssistContext {
  pull: GithubPullRequest;
  resources: PrResourcePreview[];
  prFiles: GithubPullFile[];
  comments: GithubIssueComment[];
  focusResourceId?: string | null;
}

interface ReviewAssistBarProps {
  context: ReviewAssistContext;
  /** 编辑器里当前的文字，新建预制回复时可以直接拿来用 */
  draft: string;
  /**
   * 把一段排好版的回复放进编辑器。`needFix` 有值时同时切换 NEEDFIX 标签：
   * 「不符合某条准则」的回复要求创作者修改，「请参考」的只是普通评论。
   */
  onInsert: (text: string, options?: { needFix?: boolean }) => void;
}

/**
 * 评论编辑器里的审核辅助入口：预制回复、引用准则、AI 草稿。
 * 三者产出的都是「放进编辑器的文字」，发不发、怎么改始终由审核员决定。
 */
export function ReviewAssistBar({ context, draft, onInsert }: ReviewAssistBarProps) {
  const [dialog, setDialog] = useState<"presets" | "guidelines" | "ai" | null>(null);
  const close = (open: boolean) => {
    if (!open) setDialog(null);
  };

  return (
    <>
      <div className="flex flex-wrap items-center gap-2 border-b border-white/10 bg-sky-500/[0.04] px-3 py-2">
        <Button variant="soft" size="1" onClick={() => setDialog("presets")}>
          <ChatCenteredText size={14} weight="duotone" />
          预制回复
        </Button>
        <Button variant="soft" size="1" onClick={() => setDialog("guidelines")}>
          <BookOpenText size={14} weight="duotone" />
          引用准则
        </Button>
        <Button
          variant="soft"
          size="1"
          color="violet"
          disabled={context.resources.length === 0}
          title={context.resources.length === 0 ? "资源信息还没解析出来" : undefined}
          onClick={() => setDialog("ai")}
        >
          <Sparkle size={14} weight="duotone" />
          AI 草稿
        </Button>
      </div>

      <PresetPickerDialog
        open={dialog === "presets"}
        onOpenChange={close}
        currentDraft={draft}
        onInsert={(text, preset) =>
          onInsert(text, {
            // 关闭 / 拒绝用的回复插进普通评论时不该带 NEEDFIX
            needFix: preset.action === "needfix" ? true : preset.action === "comment" ? false : undefined,
          })
        }
      />
      <GuidelinePickerDialog
        open={dialog === "guidelines"}
        onOpenChange={close}
        onInsert={(text, mode) => onInsert(text, { needFix: mode === "violation" })}
      />
      {/* 一直挂着：关掉弹窗去编辑、发送一条之后再打开，草稿和「已采用」的标记都还在 */}
      <AiDraftDialog
        open={dialog === "ai"}
        onOpenChange={close}
        pull={context.pull}
        resources={context.resources}
        prFiles={context.prFiles}
        comments={context.comments}
        focusResourceId={context.focusResourceId}
        onUse={(text, options) => onInsert(text, options)}
      />
    </>
  );
}
