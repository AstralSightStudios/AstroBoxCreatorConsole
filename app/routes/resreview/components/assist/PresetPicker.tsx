import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  AlertDialog,
  Button,
  Dialog,
  Select,
  Spinner,
  TextArea,
  TextField,
} from "~/components/ScaleAwareThemes";
import {
  DownloadSimple,
  MagnifyingGlass,
  PencilSimple,
  Plus,
  Trash,
  WarningCircle,
} from "@phosphor-icons/react";
import { toast } from "sonner";
import { REVIEW_PRESETS_QUERY_KEY, ReviewAssistApi } from "~/api/astrobox/review";
import { guidelineLabel, resolveGuidelineRefs } from "~/logic/review-assist/guidelines";
import {
  composePresetReply,
  groupReviewPresets,
  REVIEW_PRESET_ACTION_LABELS,
  REVIEW_PRESET_ACTIONS,
  validatePresetDraft,
  type ReviewPreset,
  type ReviewPresetAction,
  type ReviewPresetDraft,
} from "~/logic/review-assist/presets";
import { renderCommentMarkdownHtml } from "../../utils/comment";
import { GuidelineSelector } from "./GuidelinePicker";
import {
  describeReviewAssistError,
  useReviewGuidelines,
  useReviewPresets,
} from "./useReviewAssist";

const ACTION_STYLE: Record<ReviewPresetAction, string> = {
  needfix: "border-amber-400/30 bg-amber-500/15 text-amber-100",
  comment: "border-white/15 bg-white/10 text-white/70",
  close: "border-red-400/25 bg-red-500/10 text-red-100",
  refuse: "border-red-400/40 bg-red-500/20 text-red-100",
};

function ActionBadge({ action }: { action: ReviewPresetAction }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[11px] ${ACTION_STYLE[action]}`}
    >
      {REVIEW_PRESET_ACTION_LABELS[action]}
    </span>
  );
}

const EMPTY_DRAFT: ReviewPresetDraft = {
  title: "",
  category: "",
  body: "",
  rules: [],
  action: "needfix",
};

interface PresetEditorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 正在编辑的预制回复；新建时为 null */
  preset: ReviewPreset | null;
  /** 新建时预填的正文（把编辑器里写好的一段话存成预制回复） */
  initialBody?: string;
  categories: string[];
}

function PresetEditorDialog({
  open,
  onOpenChange,
  preset,
  initialBody,
  categories,
}: PresetEditorDialogProps) {
  const queryClient = useQueryClient();
  const guidelines = useReviewGuidelines(open);
  const [draft, setDraft] = useState<ReviewPresetDraft>(EMPTY_DRAFT);
  const [pickingRules, setPickingRules] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setError("");
    setPickingRules(false);
    setDraft(
      preset
        ? {
            title: preset.title,
            category: preset.category,
            body: preset.body,
            rules: [...preset.rules],
            action: preset.action,
          }
        : { ...EMPTY_DRAFT, body: initialBody?.trim() ?? "" },
    );
  }, [open, preset, initialBody]);

  const { entries, missing } = useMemo(
    () => resolveGuidelineRefs(guidelines.index, draft.rules),
    [guidelines.index, draft.rules],
  );

  const save = useMutation({
    mutationFn: () => {
      const payload = {
        ...draft,
        title: draft.title.trim(),
        category: draft.category.trim(),
        body: draft.body.trim(),
      };
      return preset
        ? ReviewAssistApi.presets.update(preset.id, payload)
        : ReviewAssistApi.presets.create(payload);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: REVIEW_PRESETS_QUERY_KEY });
      toast.success(preset ? "预制回复已更新" : "预制回复已添加，所有审核员都能用到");
      onOpenChange(false);
    },
    onError: (err) => setError(describeReviewAssistError(err)),
  });

  const submit = () => {
    const problem = validatePresetDraft(draft);
    if (problem) {
      setError(problem);
      return;
    }
    setError("");
    save.mutate();
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Content className="flex max-h-[min(88vh,780px)] w-[calc(100vw-2rem)] max-w-[640px] flex-col">
        <Dialog.Title>{preset ? "编辑预制回复" : "新建预制回复"}</Dialog.Title>
        <Dialog.Description size="2" className="text-white/60">
          预制回复由所有审核员共用，保存后大家立刻都能看到。
        </Dialog.Description>

        <div className="mt-3 flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pr-1">
          <div className="grid gap-3 sm:grid-cols-[1fr_180px]">
            <label className="flex flex-col gap-1 text-xs text-white/60">
              标题
              <TextField.Root
                radius="large"
                value={draft.title}
                maxLength={80}
                placeholder="例如：封面比例不合适"
                onChange={(event) => setDraft({ ...draft, title: event.target.value })}
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-white/60">
              分组
              <TextField.Root
                radius="large"
                value={draft.category}
                maxLength={40}
                placeholder="例如：封面"
                list="review-preset-categories"
                onChange={(event) => setDraft({ ...draft, category: event.target.value })}
              />
              <datalist id="review-preset-categories">
                {categories.map((category) => (
                  <option key={category} value={category} />
                ))}
              </datalist>
            </label>
          </div>

          <label className="flex flex-col gap-1 text-xs text-white/60">
            通常用于
            <Select.Root
              value={draft.action}
              onValueChange={(action) =>
                setDraft({ ...draft, action: action as ReviewPresetAction })
              }
            >
              <Select.Trigger radius="large" />
              <Select.Content position="popper">
                {REVIEW_PRESET_ACTIONS.map((action) => (
                  <Select.Item key={action} value={action}>
                    {REVIEW_PRESET_ACTION_LABELS[action]}
                    {action === "comment" ? "（准则写作「请参考」）" : "（准则写作「不符合」）"}
                  </Select.Item>
                ))}
              </Select.Content>
            </Select.Root>
          </label>

          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between text-xs text-white/60">
              <span>引用的准则（原文按文档当前内容自动展开）</span>
              <button
                type="button"
                className="text-sky-200 hover:text-sky-100"
                onClick={() => setPickingRules((value) => !value)}
              >
                {pickingRules ? "收起" : draft.rules.length > 0 ? "修改" : "选择准则"}
              </button>
            </div>
            {pickingRules ? (
              <div className="flex h-72 flex-col">
                {guidelines.error ? (
                  <p className="text-xs text-red-300">
                    {describeReviewAssistError(guidelines.error)}
                  </p>
                ) : (
                  <GuidelineSelector
                    index={guidelines.index}
                    selected={draft.rules}
                    onChange={(rules) => setDraft({ ...draft, rules })}
                  />
                )}
              </div>
            ) : draft.rules.length === 0 ? (
              <p className="text-xs text-white/35">未引用准则</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {entries.map((entry) => (
                  <span
                    key={entry.node.ref}
                    className="rounded-full border border-sky-400/30 bg-sky-500/15 px-2.5 py-0.5 text-xs text-sky-100"
                  >
                    {guidelineLabel(entry)}
                  </span>
                ))}
                {missing.map((ref) => (
                  <span
                    key={ref}
                    className="rounded-full border border-amber-400/30 bg-amber-500/15 px-2.5 py-0.5 text-xs text-amber-100"
                  >
                    {ref}（已不存在）
                  </span>
                ))}
              </div>
            )}
          </div>

          <label className="flex flex-col gap-1 text-xs text-white/60">
            正文（Markdown，不用抄写准则原文）
            <TextArea
              rows={6}
              radius="large"
              value={draft.body}
              maxLength={4000}
              placeholder="针对这类问题的固定说明，例如：头图需要图片宽高比为 1.5（3:2），最佳宽度为 1200px。"
              onChange={(event) => setDraft({ ...draft, body: event.target.value })}
            />
          </label>

          {error && (
            <p role="alert" className="text-xs text-red-300">
              {error}
            </p>
          )}
        </div>

        <div className="mt-4 flex justify-end gap-2">
          <Button variant="soft" color="gray" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button disabled={save.isPending} onClick={submit}>
            {save.isPending ? "保存中…" : "保存"}
          </Button>
        </div>
      </Dialog.Content>
    </Dialog.Root>
  );
}

interface PresetPickerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 选用一条预制回复：`text` 是展开准则引用后的完整文字 */
  onInsert: (text: string, preset: ReviewPreset) => void;
  /** 这些用途的回复排在前面（关闭 / 拒绝弹窗里先看到对应的那几条） */
  preferred?: readonly ReviewPresetAction[];
  /** 编辑器里已经写好的内容，可以直接存成一条新的预制回复 */
  currentDraft?: string;
}

/**
 * 预制回复：搜索、点选即插入。右侧预览的是展开准则引用后真正会发出去的文字。
 * 所有审核员共用一份，可以在这里新增、修改、删除。
 */
export function PresetPickerDialog({
  open,
  onOpenChange,
  onInsert,
  preferred,
  currentDraft,
}: PresetPickerDialogProps) {
  const queryClient = useQueryClient();
  const presets = useReviewPresets(open);
  const guidelines = useReviewGuidelines(open);
  const [query, setQuery] = useState("");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [editor, setEditor] = useState<{ preset: ReviewPreset | null; body?: string } | null>(
    null,
  );
  const [deleting, setDeleting] = useState<ReviewPreset | null>(null);

  useEffect(() => {
    if (open) {
      setQuery("");
      setActiveId(null);
    }
  }, [open]);

  const groups = useMemo(
    () => groupReviewPresets(presets.presets, { query, preferred }),
    [presets.presets, query, preferred],
  );
  const visible = useMemo(() => groups.flatMap((group) => group.items), [groups]);
  const active = visible.find((item) => item.id === activeId) ?? visible[0] ?? null;
  const expanded = useMemo(
    () => (active ? composePresetReply(active, guidelines.index) : null),
    [active, guidelines.index],
  );
  const categories = useMemo(
    () => [...new Set(presets.presets.map((item) => item.category.trim()).filter(Boolean))],
    [presets.presets],
  );

  const importDefaults = useMutation({
    mutationFn: ReviewAssistApi.presets.importDefaults,
    onSuccess: (result) => {
      queryClient.setQueryData(REVIEW_PRESETS_QUERY_KEY, result.items);
      toast.success(
        result.added > 0 ? `已导入 ${result.added} 条默认预制回复` : "默认预制回复都已经在列表里了",
      );
    },
    onError: (err) => toast.error(describeReviewAssistError(err)),
  });

  const remove = useMutation({
    mutationFn: (id: string) => ReviewAssistApi.presets.remove(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: REVIEW_PRESETS_QUERY_KEY });
      toast.success("预制回复已删除");
      setDeleting(null);
    },
    onError: (err) => toast.error(describeReviewAssistError(err)),
  });

  const insert = (preset: ReviewPreset) => {
    const { text, missing } = composePresetReply(preset, guidelines.index);
    if (preset.rules.length > 0 && guidelines.index.size === 0) {
      toast.warning("准则还没加载出来，这次只插入了正文，没有带准则引用。");
    } else if (missing.length > 0) {
      toast.warning(`这条回复引用的准则 ${missing.join("、")} 在当前文档里已经找不到，没有带上。`);
    }
    onInsert(text, preset);
    onOpenChange(false);
  };

  const loadError = presets.error ?? null;

  return (
    <>
      <Dialog.Root open={open} onOpenChange={onOpenChange}>
        <Dialog.Content className="flex max-h-[min(86vh,760px)] w-[calc(100vw-2rem)] max-w-[860px] flex-col">
          <Dialog.Title>预制回复</Dialog.Title>
          <Dialog.Description size="2" className="text-white/60">
            点选即插入评论。引用的准则原文取自文档当前版本，插入后可以再补充一两句。
          </Dialog.Description>

          <div className="mt-3 flex items-center gap-2">
            <TextField.Root
              size="2"
              radius="large"
              autoFocus
              className="flex-1"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索标题、内容或准则编号"
              aria-label="搜索预制回复"
            >
              <TextField.Slot>
                <MagnifyingGlass size={14} />
              </TextField.Slot>
            </TextField.Root>
            <Button
              variant="soft"
              onClick={() => setEditor({ preset: null, body: currentDraft })}
              title={currentDraft?.trim() ? "以编辑器里的内容新建" : "新建预制回复"}
            >
              <Plus size={14} weight="bold" />
              新建
            </Button>
          </div>

          <div className="mt-3 flex min-h-0 flex-1 flex-col gap-3 md:flex-row">
            <div className="min-h-[180px] flex-1 overflow-y-auto rounded-xl border border-white/10 bg-black/20 md:max-w-[340px]">
              {!presets.signedIn ? (
                <p className="px-3 py-6 text-center text-sm text-amber-200">
                  请先登录 AstroBox 账号。
                </p>
              ) : presets.isLoading ? (
                <div className="flex items-center justify-center gap-2 py-10 text-sm text-white/50">
                  <Spinner size="2" />
                  正在读取…
                </div>
              ) : loadError ? (
                <div className="flex items-start gap-2 px-3 py-4 text-sm text-red-200">
                  <WarningCircle size={16} weight="duotone" className="mt-0.5 shrink-0" />
                  <span className="min-w-0 break-words">{describeReviewAssistError(loadError)}</span>
                </div>
              ) : presets.presets.length === 0 ? (
                <div className="flex flex-col items-center gap-3 px-4 py-8 text-center">
                  <p className="text-sm text-white/55">
                    还没有预制回复。可以先导入一份默认内容（整理自审核常用语），再按需修改。
                  </p>
                  <Button
                    variant="soft"
                    disabled={importDefaults.isPending}
                    onClick={() => importDefaults.mutate()}
                  >
                    <DownloadSimple size={14} weight="bold" />
                    {importDefaults.isPending ? "导入中…" : "导入默认预制回复"}
                  </Button>
                </div>
              ) : groups.length === 0 ? (
                <p className="px-3 py-6 text-center text-sm text-white/40">没有匹配的预制回复</p>
              ) : (
                groups.map((group) => (
                  <div key={group.category}>
                    <p className="sticky top-0 border-b border-white/5 bg-[var(--color-panel-solid)] px-3 py-1.5 text-xs font-medium text-white/45">
                      {group.category}
                    </p>
                    {group.items.map((preset) => (
                      <div
                        key={preset.id}
                        className={`group flex items-center gap-2 border-b border-white/5 px-3 py-2 last:border-b-0 ${
                          active?.id === preset.id ? "bg-white/[0.08]" : "hover:bg-white/[0.04]"
                        }`}
                        onMouseEnter={() => setActiveId(preset.id)}
                      >
                        <button
                          type="button"
                          className="flex min-w-0 flex-1 items-center gap-2 text-left"
                          onFocus={() => setActiveId(preset.id)}
                          onClick={() => insert(preset)}
                        >
                          <span className="truncate text-sm text-white/85">{preset.title}</span>
                          <ActionBadge action={preset.action} />
                        </button>
                        <button
                          type="button"
                          className="text-white/35 opacity-0 transition hover:text-white focus:opacity-100 group-hover:opacity-100"
                          onClick={() => setEditor({ preset })}
                          aria-label={`编辑「${preset.title}」`}
                        >
                          <PencilSimple size={14} />
                        </button>
                        <button
                          type="button"
                          className="text-white/35 opacity-0 transition hover:text-red-300 focus:opacity-100 group-hover:opacity-100"
                          onClick={() => setDeleting(preset)}
                          aria-label={`删除「${preset.title}」`}
                        >
                          <Trash size={14} />
                        </button>
                      </div>
                    ))}
                  </div>
                ))
              )}
            </div>

            <div className="flex min-h-[160px] flex-1 flex-col rounded-xl border border-white/10 bg-white/[0.03]">
              {active && expanded ? (
                <>
                  <div className="flex items-center gap-2 border-b border-white/10 px-3 py-2">
                    <span className="min-w-0 flex-1 truncate text-sm font-medium text-white">
                      {active.title}
                    </span>
                    <Button size="1" onClick={() => insert(active)}>
                      插入
                    </Button>
                  </div>
                  <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
                    {expanded.text ? (
                      <div
                        className="break-words text-sm leading-6 text-white/80"
                        dangerouslySetInnerHTML={{
                          __html: renderCommentMarkdownHtml(expanded.text),
                        }}
                      />
                    ) : (
                      <p className="text-sm text-white/35">（空）</p>
                    )}
                    {expanded.missing.length > 0 && guidelines.index.size > 0 && (
                      <p className="mt-2 text-xs text-amber-300">
                        引用的准则 {expanded.missing.join("、")} 在当前文档里已经找不到，请编辑这条预制回复。
                      </p>
                    )}
                  </div>
                </>
              ) : (
                <p className="m-auto px-4 text-center text-sm text-white/35">
                  把鼠标移到左侧的一条上预览，点击即插入
                </p>
              )}
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
            {presets.presets.length > 0 ? (
              <button
                type="button"
                className="text-xs text-white/45 hover:text-white disabled:opacity-50"
                disabled={importDefaults.isPending}
                onClick={() => importDefaults.mutate()}
              >
                补入缺少的默认预制回复
              </button>
            ) : (
              <span />
            )}
            <Button variant="soft" color="gray" onClick={() => onOpenChange(false)}>
              关闭
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Root>

      <PresetEditorDialog
        open={editor !== null}
        onOpenChange={(next) => {
          if (!next) setEditor(null);
        }}
        preset={editor?.preset ?? null}
        initialBody={editor?.body}
        categories={categories}
      />

      <AlertDialog.Root
        open={deleting !== null}
        onOpenChange={(next) => {
          if (!next) setDeleting(null);
        }}
      >
        <AlertDialog.Content className="max-w-[420px]">
          <AlertDialog.Title>删除预制回复</AlertDialog.Title>
          <AlertDialog.Description size="2">
            「{deleting?.title}」会从所有审核员的列表里消失，无法恢复。
          </AlertDialog.Description>
          <div className="mt-4 flex justify-end gap-2">
            <AlertDialog.Cancel>
              <Button variant="soft" color="gray">
                取消
              </Button>
            </AlertDialog.Cancel>
            <Button
              color="red"
              disabled={remove.isPending}
              onClick={() => deleting && remove.mutate(deleting.id)}
            >
              {remove.isPending ? "删除中…" : "删除"}
            </Button>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Root>
    </>
  );
}
