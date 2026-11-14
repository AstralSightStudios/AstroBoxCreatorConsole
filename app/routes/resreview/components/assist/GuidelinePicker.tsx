import { useEffect, useMemo, useState } from "react";
import {
  Button,
  Dialog,
  SegmentedControl,
  Spinner,
  TextField,
} from "~/components/ScaleAwareThemes";
import {
  ArrowsClockwise,
  ArrowSquareOut,
  BookOpenText,
  Check,
  MagnifyingGlass,
  WarningCircle,
  X,
} from "@phosphor-icons/react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { toast } from "sonner";
import {
  composeReviewReply,
  guidelineLabel,
  guidelineQuote,
  resolveGuidelineRefs,
  searchGuidelines,
  type CitationMode,
  type GuidelineEntry,
  type GuidelineIndex,
} from "~/logic/review-assist/guidelines";
import { renderCommentMarkdownHtml } from "../../utils/comment";
import { describeReviewAssistError, useReviewGuidelines } from "./useReviewAssist";

async function openExternal(url: string) {
  try {
    await openUrl(url);
  } catch {
    window.open(url, "_blank", "noopener,noreferrer");
  }
}

function depthOf(entry: GuidelineEntry): number {
  return entry.node === entry.document.root ? 0 : entry.ancestors.length + 1;
}

/** 准则列表里一行的摘要：条款原文的第一段，去掉 Markdown 标记。 */
function previewOf(entry: GuidelineEntry): string {
  const source = entry.node.text || guidelineQuote(entry);
  return source
    .split(/\n{2,}/)[0]
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[*`>#|]/g, "")
    .trim();
}

interface GuidelineSelectorProps {
  index: GuidelineIndex;
  selected: string[];
  onChange: (refs: string[]) => void;
}

/**
 * 条款选择器：搜索框 + 按文档顺序排列的条款树，可多选。
 * 输入编号（如 2.6）直接定位到那一节；其余按标题和正文搜索。
 */
export function GuidelineSelector({ index, selected, onChange }: GuidelineSelectorProps) {
  const [query, setQuery] = useState("");
  const results = useMemo(() => searchGuidelines(index, query), [index, query]);
  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const { entries: selectedEntries, missing } = useMemo(
    () => resolveGuidelineRefs(index, selected),
    [index, selected],
  );

  const toggle = (ref: string) => {
    onChange(selectedSet.has(ref) ? selected.filter((item) => item !== ref) : [...selected, ref]);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <TextField.Root
        size="2"
        radius="large"
        autoFocus
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="输入编号（如 2.6）或关键词（如 封面 比例）"
        aria-label="搜索准则"
      >
        <TextField.Slot>
          <MagnifyingGlass size={14} />
        </TextField.Slot>
      </TextField.Root>

      {(selectedEntries.length > 0 || missing.length > 0) && (
        <div className="flex flex-wrap gap-1.5">
          {selectedEntries.map((entry) => (
            <span
              key={entry.node.ref}
              className="inline-flex items-center gap-1 rounded-full border border-sky-400/30 bg-sky-500/15 py-0.5 pl-2.5 pr-1 text-xs text-sky-100"
            >
              {guidelineLabel(entry)}
              <button
                type="button"
                className="grid size-4 place-items-center rounded-full text-sky-100/70 hover:bg-white/15 hover:text-white"
                onClick={() => toggle(entry.node.ref)}
                aria-label={`移除 ${guidelineLabel(entry)}`}
              >
                <X size={10} weight="bold" />
              </button>
            </span>
          ))}
          {missing.map((ref) => (
            <span
              key={ref}
              className="inline-flex items-center gap-1 rounded-full border border-amber-400/30 bg-amber-500/15 py-0.5 pl-2.5 pr-1 text-xs text-amber-100"
              title="当前文档里已经没有这一条"
            >
              {ref}（已不存在）
              <button
                type="button"
                className="grid size-4 place-items-center rounded-full text-amber-100/70 hover:bg-white/15 hover:text-white"
                onClick={() => toggle(ref)}
                aria-label={`移除 ${ref}`}
              >
                <X size={10} weight="bold" />
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto rounded-xl border border-white/10 bg-black/20">
        {results.length === 0 ? (
          <p className="px-3 py-6 text-center text-sm text-white/40">没有匹配的准则</p>
        ) : (
          results.map((entry) => {
            const { node, document } = entry;
            const isRoot = node === document.root;
            const checked = selectedSet.has(node.ref);
            const preview = previewOf(entry);
            return (
              <button
                key={node.ref}
                type="button"
                onClick={() => toggle(node.ref)}
                aria-pressed={checked}
                className={`flex w-full items-start gap-2 border-b border-white/5 py-2 pr-3 text-left transition last:border-b-0 hover:bg-white/[0.06] ${
                  checked ? "bg-sky-500/10" : ""
                }`}
                // 搜索时结果是打平的，缩进只在浏览整棵树时才有意义
                style={{ paddingLeft: 12 + (query.trim() ? 0 : depthOf(entry) * 14) }}
              >
                <span
                  className={`mt-0.5 grid size-4 shrink-0 place-items-center rounded border ${
                    checked ? "border-sky-400 bg-sky-500 text-white" : "border-white/25"
                  }`}
                >
                  {checked && <Check size={10} weight="bold" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-baseline gap-x-2">
                    {node.number && (
                      <span className="font-mono text-xs text-sky-200">{node.number}</span>
                    )}
                    <span
                      className={`text-sm ${
                        isRoot || !node.number || node.children.length > 0
                          ? "font-medium text-white"
                          : "text-white/80"
                      }`}
                    >
                      {isRoot ? `《${document.title}》` : node.title}
                    </span>
                    {!node.number && !isRoot && query.trim() && (
                      <span className="text-xs text-white/35">{document.title}</span>
                    )}
                  </span>
                  {preview && (
                    <span className="mt-0.5 line-clamp-2 block text-xs leading-relaxed text-white/50">
                      {preview}
                    </span>
                  )}
                </span>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}

interface GuidelineSourceBarProps {
  revision?: string;
  fetchedAt?: string;
  stale?: boolean;
  refreshing: boolean;
  onRefresh: () => void;
}

/** 准则来自哪一版文档、什么时候同步的，以及手动刷新。 */
export function GuidelineSourceBar({
  revision,
  fetchedAt,
  stale,
  refreshing,
  onRefresh,
}: GuidelineSourceBarProps) {
  const time = fetchedAt ? new Date(fetchedAt) : null;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-white/45">
      <span className="inline-flex items-center gap-1">
        <BookOpenText size={13} weight="duotone" />
        实时取自文档仓库
        {revision ? (
          <code className="rounded bg-white/10 px-1 text-white/60">{revision.slice(0, 7)}</code>
        ) : null}
        {time && !Number.isNaN(time.getTime()) ? `· ${time.toLocaleTimeString()} 同步` : ""}
      </span>
      {stale && (
        <span className="inline-flex items-center gap-1 text-amber-300">
          <WarningCircle size={13} weight="fill" />
          服务端暂时连不上文档仓库，这是上一次读到的内容
        </span>
      )}
      <button
        type="button"
        className="ml-auto inline-flex items-center gap-1 text-white/55 hover:text-white disabled:opacity-50"
        onClick={onRefresh}
        disabled={refreshing}
      >
        {refreshing ? <Spinner size="1" /> : <ArrowsClockwise size={13} />}
        刷新
      </button>
      <button
        type="button"
        className="inline-flex items-center gap-1 text-white/55 hover:text-white"
        onClick={() => void openExternal("https://abox.run/docs/creator-tools/resource-std/content")}
      >
        <ArrowSquareOut size={13} />
        文档站
      </button>
    </div>
  );
}

interface GuidelinePickerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 插入排好版的引用；`mode` 为 violation 时这条评论通常要标 NEEDFIX */
  onInsert: (text: string, mode: CitationMode) => void;
}

/**
 * 引用准则：选条款、选「不符合 / 请参考」，下方实时预览将要插入的文字。
 * 审核员只需要在引用后面补一两句针对这个资源的说明。
 */
export function GuidelinePickerDialog({ open, onOpenChange, onInsert }: GuidelinePickerDialogProps) {
  const guidelines = useReviewGuidelines(open);
  const [selected, setSelected] = useState<string[]>([]);
  const [mode, setMode] = useState<CitationMode>("violation");
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    if (open) setSelected([]);
  }, [open]);

  const { entries } = useMemo(
    () => resolveGuidelineRefs(guidelines.index, selected),
    [guidelines.index, selected],
  );
  const previewText = useMemo(() => composeReviewReply({ entries, mode }), [entries, mode]);

  const refresh = async () => {
    setRefreshing(true);
    try {
      await guidelines.refresh();
      toast.success("准则已同步到最新");
    } catch (error) {
      toast.error(describeReviewAssistError(error));
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Content className="flex max-h-[min(86vh,760px)] w-[calc(100vw-2rem)] max-w-[720px] flex-col">
        <Dialog.Title>引用准则</Dialog.Title>
        <Dialog.Description size="2" className="text-white/60">
          选中的条款会连同原文一起插入评论，你只需要在后面补充针对这个资源的说明。
        </Dialog.Description>

        <div className="mt-3 flex min-h-0 flex-1 flex-col gap-3">
          {!guidelines.signedIn ? (
            <p className="rounded-lg border border-amber-400/20 bg-amber-500/10 px-3 py-2 text-sm text-amber-100">
              请先登录 AstroBox 账号。
            </p>
          ) : guidelines.isLoading ? (
            <div className="flex items-center justify-center gap-2 py-10 text-sm text-white/50">
              <Spinner size="2" />
              正在读取准则…
            </div>
          ) : guidelines.error ? (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-lg border border-red-400/20 bg-red-500/10 px-3 py-2 text-sm text-red-100"
            >
              <WarningCircle size={16} weight="duotone" className="mt-0.5 shrink-0" />
              <span className="min-w-0 flex-1 break-words">
                {describeReviewAssistError(guidelines.error)}
              </span>
              <button
                type="button"
                className="shrink-0 underline underline-offset-2"
                onClick={() => void guidelines.refetch()}
              >
                重试
              </button>
            </div>
          ) : (
            <>
              <GuidelineSourceBar
                revision={guidelines.guidelines?.revision}
                fetchedAt={guidelines.guidelines?.fetchedAt}
                stale={guidelines.guidelines?.stale}
                refreshing={refreshing}
                onRefresh={() => void refresh()}
              />
              <GuidelineSelector
                index={guidelines.index}
                selected={selected}
                onChange={setSelected}
              />
              {previewText && (
                <div className="max-h-40 shrink-0 overflow-y-auto rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2">
                  <div
                    className="break-words text-sm leading-6 text-white/80"
                    dangerouslySetInnerHTML={{ __html: renderCommentMarkdownHtml(previewText) }}
                  />
                </div>
              )}
            </>
          )}
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <SegmentedControl.Root
            size="2"
            value={mode}
            onValueChange={(value) => setMode(value as CitationMode)}
          >
            <SegmentedControl.Item value="violation">不符合…</SegmentedControl.Item>
            <SegmentedControl.Item value="reference">请参考…</SegmentedControl.Item>
          </SegmentedControl.Root>
          <div className="flex gap-2">
            <Button variant="soft" color="gray" onClick={() => onOpenChange(false)}>
              取消
            </Button>
            <Button
              disabled={entries.length === 0}
              onClick={() => {
                onInsert(previewText, mode);
                onOpenChange(false);
              }}
            >
              插入引用{entries.length > 0 ? `（${entries.length}）` : ""}
            </Button>
          </div>
        </div>
      </Dialog.Content>
    </Dialog.Root>
  );
}
