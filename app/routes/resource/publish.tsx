import {
  ArrowClockwiseIcon,
  ArrowDownIcon,
  CheckCircleIcon,
  CheckIcon,
  CheckSquareIcon,
  ClockIcon,
  CopyIcon,
  EyeIcon,
  EyeSlashIcon,
  FileArrowUpIcon,
  GithubLogoIcon,
  ListMagnifyingGlassIcon,
  PencilSimpleIcon,
  WarningOctagonIcon,
} from "@phosphor-icons/react";
import {
  AlertDialog,
  Badge,
  Button,
  Callout,
  SegmentedControl,
  Spinner,
  Table,
} from "~/components/ScaleAwareThemes";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import PageHeader from "~/components/page-header";
import Page from "~/layout/page";
import { useListViewMode } from "~/logic/ui/list-view-mode";
import { indexItemIconUrl } from "~/logic/catalog/index-v2";
import {
  openExternal,
  ResourceIcon,
} from "~/routes/manage-resources/components/ResourceVisuals";
import {
  createPullRequestComment,
  getPullRequest,
  reopenPullRequest,
  waitForPullRequestOpen,
} from "~/api/github/pr-review";
import { isGithubStatus } from "~/logic/publish/github-actions";
import { loadAccountState } from "~/logic/account/store";
import { decodeCatalogContent, getFileContent } from "~/logic/publish/catalog";
import {
  clearInProgressResourcesCache,
  loadInProgressResourcesForCurrentUser,
  type PublishingResource,
  type ResourceEditContext,
} from "~/logic/publish/resources";
import {
  hidePullRequestRecord,
  unhidePullRequestRecord,
} from "~/logic/publish/pr-visibility";
import {
  parseSubmissionRequestJson,
  submissionRequestPath,
} from "~/logic/publish/submission-protocol";
import { formatResourceType } from "~/logic/publish/resource-type";

/** 合并分页结果：同一个 PR 的同一资源只在列表中保留一条。 */
function mergeResourcePages(
  previous: PublishingResource[],
  next: PublishingResource[],
): PublishingResource[] {
  const byKey = new Map<string, PublishingResource>();
  for (const item of previous) {
    byKey.set(`${item.prNumber}:${item.id}`, item);
  }
  for (const item of next) {
    byKey.set(`${item.prNumber}:${item.id}`, item);
  }
  return Array.from(byKey.values()).sort((a, b) =>
    (b.createdAt || "").localeCompare(a.createdAt || ""),
  );
}

function useInProgressResources(refreshTick: number) {
  const [data, setData] = useState<PublishingResource[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState("");
  const pageRef = useRef(1);
  const requestRef = useRef(0);

  useEffect(() => {
    let active = true;
    const requestId = ++requestRef.current;
    pageRef.current = 1;
    setLoading(true);
    setLoadingMore(false);
    setError("");
    const run = async () => {
      try {
        const result = await loadInProgressResourcesForCurrentUser({
          page: 1,
        });
        if (!active || requestId !== requestRef.current) return;
        setData(result.data);
        setHasMore(result.hasMore);
      } catch (err) {
        if (active && requestId === requestRef.current) {
          setError((err as Error).message || "加载失败");
        }
      } finally {
        if (active && requestId === requestRef.current) setLoading(false);
      }
    };
    void run();
    return () => {
      active = false;
    };
  }, [refreshTick]);

  /** 点击后才请求下一页，避免一次性拉取全部历史 PR 的评论与文件。 */
  const loadMore = useCallback(async () => {
    if (loading || loadingMore || !hasMore) return;
    const requestId = requestRef.current;
    const nextPage = pageRef.current + 1;
    setLoadingMore(true);
    try {
      const result = await loadInProgressResourcesForCurrentUser({
        page: nextPage,
      });
      if (requestId !== requestRef.current) return;
      pageRef.current = nextPage;
      setData((previous) => mergeResourcePages(previous, result.data));
      setHasMore(result.hasMore);
    } catch (err) {
      if (requestId === requestRef.current) {
        toast.error((err as Error).message || "加载更多失败");
      }
    } finally {
      if (requestId === requestRef.current) setLoadingMore(false);
    }
  }, [hasMore, loading, loadingMore]);

  return {
    data,
    setData,
    loading,
    loadingMore,
    hasMore,
    loadMore,
    error,
  };
}

/** 批量隐藏时限制并发，避免集中触发 GitHub 的二级速率限制。 */
async function runWithConcurrency<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>,
) {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const index = next;
        next += 1;
        await worker(items[index]);
      }
    }),
  );
}

/** 只有仍处于 closed、且尚未隐藏的 PR 才能被批量隐藏。 */
function isHideable(resource: PublishingResource) {
  return resource.prState === "closed" && !resource.hidden;
}

function statusRender(resource: PublishingResource) {
  if (resource.refused) {
    return (
      <span className="flex items-center gap-1 text-purple-300">
        <WarningOctagonIcon size={18} weight="fill" /> 已拒绝
        <span className="text-xs text-white/35">（点击查看原因）</span>
      </span>
    );
  }
  if (resource.prState === "merged") {
    return (
      <span className="flex items-center gap-1 text-white/45">
        <CheckCircleIcon size={18} weight="fill" /> 已合入
      </span>
    );
  }
  if (resource.prState === "closed") {
    return (
      <span className="flex items-center gap-1 text-red-300">
        <WarningOctagonIcon size={18} weight="fill" /> 已关闭
      </span>
    );
  }
  if (resource.status === "changes_requested") {
    return (
      <span className="flex items-center gap-1 text-amber-300">
        <PencilSimpleIcon size={18} weight="fill" /> 需要修改
      </span>
    );
  }
  if (resource.status === "fixed_waiting") {
    return (
      <span className="flex items-center gap-1 text-emerald-300">
        <CheckCircleIcon size={18} weight="fill" /> 已修复，等待审核
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1">
      <ClockIcon size={18} weight="fill" /> 等待审核
    </span>
  );
}

export default function ResourcePublish() {
  const navigate = useNavigate();
  const [refreshTick, setRefreshTick] = useState(0);
  const [reopening, setReopening] = useState<number | null>(null);
  const [selectingPr, setSelectingPr] = useState<number | null>(null);
  const [refuseTarget, setRefuseTarget] = useState<PublishingResource | null>(
    null,
  );
  const { data, setData, loading, loadingMore, hasMore, loadMore, error } =
    useInProgressResources(refreshTick);
  const [showHidden, setShowHidden] = useState(false);
  const [visibilityBusy, setVisibilityBusy] = useState<number | null>(null);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedNumbers, setSelectedNumbers] = useState<Set<number>>(
    new Set(),
  );
  const [bulkHiding, setBulkHiding] = useState(false);
  const [bulkHideDialogOpen, setBulkHideDialogOpen] = useState(false);
  const viewMode = useListViewMode("resource-publish-review-view");

  const hiddenPrNumbers = useMemo(() => {
    const numbers = new Set<number>();
    for (const item of data) {
      if (item.prState === "closed" && item.hidden) {
        numbers.add(item.prNumber);
      }
    }
    return numbers;
  }, [data]);
  const hiddenCount = hiddenPrNumbers.size;
  const hideableCount = useMemo(() => {
    const numbers = new Set<number>();
    for (const item of data) {
      if (isHideable(item)) numbers.add(item.prNumber);
    }
    return numbers.size;
  }, [data]);
  const visibleData = useMemo(
    () =>
      showHidden
        ? data
        : data.filter((item) => !(item.prState === "closed" && item.hidden)),
    [data, showHidden],
  );

  const handleSelect = async (resource: PublishingResource) => {
    if (resource.kind === "delete") {
      if (resource.prUrl) {
        openExternal(resource.prUrl);
      }
      toast.info("这是删除申请，已为你打开 GitHub PR。");
      return;
    }
    if (resource.refused) {
      setRefuseTarget(resource);
      return;
    }
    if (resource.prState === "merged") return;
    setSelectingPr(resource.prNumber);
    try {
      const token = loadAccountState().github?.token;
      if (!token) throw new Error("请先登录 GitHub 账号。");
      // 列表不再预载 head / request.json，进入编辑时再拉取最新信息。
      const full = await getPullRequest(resource.prNumber);
      const headRepo = full.head?.repo;
      const prHead = headRepo
        ? {
            owner: headRepo.owner?.login || "",
            repo: headRepo.name,
            ref: full.head.ref,
          }
        : resource.prHead;

      let submission: ResourceEditContext["submission"];
      if (resource.submission?.path) {
        if (!prHead) {
          throw new Error("缺少 PR 分支信息，无法载入提交明细。");
        }
        const requestFile = await getFileContent(
          token,
          prHead.owner,
          prHead.repo,
          submissionRequestPath(resource.submission.path),
          prHead.ref,
        );
        submission = {
          path: resource.submission.path,
          request: parseSubmissionRequestJson(
            decodeCatalogContent(requestFile.content),
          ),
        };
      }

      const editContext: ResourceEditContext = {
        mode: "in_progress",
        catalog: resource.catalog,
        prNumber: resource.prNumber,
        prUrl: resource.prUrl,
        prTitle: resource.prTitle,
        prState: resource.prState,
        prHead,
        reviewState: resource.status,
        needs: resource.needs,
        submission,
      };
      navigate("/publish/edit", { state: { editContext } });
    } catch (err) {
      toast.error((err as Error).message || "进入编辑失败");
    } finally {
      setSelectingPr(null);
    }
  };

  const handleReopen = async (resource: PublishingResource) => {
    if (reopening !== null) return;
    const prNumber = resource.prNumber;
    setReopening(prNumber);
    try {
      // 组织成员可以直接重开；外部贡献者对目标仓库只有读权限，GitHub 会返回一个
      // 不含任何明细的 422。此时改为发 [ABCC_REOPEN] 评论，由仓库侧 GitHub Actions
      // 用仓库自己的 token 代为重开，再等它几秒。
      let reopened = false;
      try {
        await reopenPullRequest(prNumber);
        reopened = true;
      } catch (err) {
        if (!isGithubStatus(err, 422)) throw err;
      }

      await createPullRequestComment(
        prNumber,
        reopened
          ? "[ABCC_REOPEN] 创作者已重新打开此 PR。"
          : "[ABCC_REOPEN] 创作者请求重新打开此 PR。",
      );

      if (!reopened) {
        reopened = await waitForPullRequestOpen(prNumber, { timeoutMs: 20_000 });
      }

      if (reopened) {
        toast.success("PR 已重新打开，并已记录 REOPEN 标签。");
      } else {
        toast.warning("重开请求已提交，仓库暂未重开该 PR，请稍后刷新查看。");
      }
      setRefreshTick((prev) => prev + 1);
    } catch (err) {
      toast.error((err as Error).message || "重新打开 PR 失败");
    } finally {
      setReopening(null);
    }
  };

  const setHiddenFlag = (prNumber: number, hidden: boolean) => {
    setData((prev) =>
      prev.map((item) =>
        item.prNumber === prNumber
          ? { ...item, hidden: hidden || undefined }
          : item,
      ),
    );
  };

  const handleUnhide = async (prNumber: number) => {
    if (visibilityBusy !== null) return;
    setVisibilityBusy(prNumber);
    try {
      await unhidePullRequestRecord(prNumber);
      setHiddenFlag(prNumber, false);
      clearInProgressResourcesCache();
      toast.success(`已恢复显示 PR #${prNumber}`);
    } catch (err) {
      toast.error((err as Error).message || "恢复显示失败");
    } finally {
      setVisibilityBusy(null);
    }
  };

  const enterSelectMode = () => {
    setSelectMode(true);
    setSelectedNumbers(new Set());
  };

  const exitSelectMode = () => {
    setSelectMode(false);
    setSelectedNumbers(new Set());
  };

  const toggleSelect = (prNumber: number) => {
    setSelectedNumbers((prev) => {
      const next = new Set(prev);
      if (next.has(prNumber)) next.delete(prNumber);
      else next.add(prNumber);
      return next;
    });
  };

  /**
   * 批量隐藏：只处理仍处于 closed 且尚未隐藏的 PR。
   * 选中期间状态可能被其他设备改变，落库前按当前数据再过滤一次。
   */
  const bulkHide = async () => {
    if (bulkHiding) return;
    const targets = Array.from(selectedNumbers).filter((prNumber) =>
      data.some(
        (item) =>
          item.prNumber === prNumber &&
          item.prState === "closed" &&
          !item.hidden,
      ),
    );
    if (targets.length === 0) {
      setBulkHideDialogOpen(false);
      return;
    }

    setBulkHiding(true);
    const succeeded: number[] = [];
    const failed: number[] = [];
    try {
      await runWithConcurrency(targets, 3, async (prNumber) => {
        try {
          await hidePullRequestRecord(prNumber);
          succeeded.push(prNumber);
        } catch (error) {
          console.error("批量隐藏 PR 失败", prNumber, error);
          failed.push(prNumber);
        }
      });

      if (succeeded.length > 0) {
        const done = new Set(succeeded);
        setData((prev) =>
          prev.map((item) =>
            done.has(item.prNumber) ? { ...item, hidden: true } : item,
          ),
        );
        clearInProgressResourcesCache();
        toast.success(`已隐藏 ${succeeded.length} 个 PR 记录`);
      }
      if (failed.length > 0) {
        toast.error(
          `有 ${failed.length} 个 PR 隐藏失败：${failed
            .map((number) => `#${number}`)
            .join("、")}`,
        );
      }
      exitSelectMode();
    } finally {
      setBulkHiding(false);
      setBulkHideDialogOpen(false);
    }
  };

  const content = useMemo(() => {
    if (loading) {
      return (
        <div className="flex flex-col items-center justify-center gap-2.5 px-3 py-8">
          <Spinner size="2" />
          <span className="text-sm font-semibold text-white/45">
            正在载入申请列表资源...
          </span>
        </div>
      );
    }
    if (error) {
      return (
        <Callout.Root
          color="red"
          variant="soft"
          className="-mb-2.5 bg-transparent! p-3!"
        >
          <Callout.Icon>
            <WarningOctagonIcon size={16} weight="fill" />
          </Callout.Icon>
          <Callout.Text className="font-semibold">
            <span>加载失败：{error}</span>
          </Callout.Text>
        </Callout.Root>
      );
    }
    if (visibleData.length === 0) {
      return (
        <p className="px-3 text-sm text-white/70">
          {selectMode
            ? "没有可操作的记录，点击「取消」退出批量管理。"
            : hiddenCount > 0 && !showHidden
              ? `有 ${hiddenCount} 个已关闭的 PR 被隐藏，点击上方「显示已隐藏」可查看。`
              : "暂无发布申请，点击下方按钮开始新的提交。"}
        </p>
      );
    }
    return null;
  }, [
    error,
    hiddenCount,
    loading,
    selectMode,
    showHidden,
    visibleData.length,
  ]);

  return (
    <Page>
      <AlertDialog.Root
        open={refuseTarget !== null}
        onOpenChange={(open) => {
          if (!open) setRefuseTarget(null);
        }}
      >
        <AlertDialog.Content maxWidth="440px">
          <AlertDialog.Title>PR 已被拒绝</AlertDialog.Title>
          <AlertDialog.Description size="2" className="text-white/60">
            {refuseTarget?.prTitle || "资源更新"} · PR #
            {refuseTarget?.prNumber ?? ""}
          </AlertDialog.Description>
          <div className="mt-3 rounded-md border border-purple-400/25 bg-purple-400/5 p-3 text-sm leading-6 text-white/80">
            {refuseTarget?.refuseReason || "（未填写拒绝原因）"}
          </div>
          {refuseTarget?.prUrl && (
            <a
              href={refuseTarget.prUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-3 inline-block text-sm text-blue-400 transition hover:text-blue-300"
            >
              在 GitHub 查看该 PR
            </a>
          )}
          <div className="mt-4 flex justify-end">
            <AlertDialog.Cancel>
              <Button variant="soft" color="gray">
                知道了
              </Button>
            </AlertDialog.Cancel>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Root>
      <AlertDialog.Root
        open={bulkHideDialogOpen}
        onOpenChange={(open) => {
          if (!bulkHiding) setBulkHideDialogOpen(open);
        }}
      >
        <AlertDialog.Content maxWidth="440px">
          <AlertDialog.Title>
            隐藏 {selectedNumbers.size} 个 PR 记录
          </AlertDialog.Title>
          <AlertDialog.Description size="2" className="text-white/60">
            隐藏后这些已关闭的记录会从审核列表移除，并在对应 PR 上留下
            [ABCC_HIDE] 标记，所有设备统一生效。不会关闭或删除 PR；之后可在「显示已隐藏」中恢复。
          </AlertDialog.Description>
          <div className="mt-4 flex justify-end gap-2">
            <AlertDialog.Cancel>
              <Button variant="soft" color="gray" disabled={bulkHiding}>
                取消
              </Button>
            </AlertDialog.Cancel>
            <Button
              variant="soft"
              color="gray"
              disabled={bulkHiding}
              onClick={() => void bulkHide()}
            >
              <EyeSlashIcon size={15} weight="bold" />
              {bulkHiding ? "隐藏中..." : "确认隐藏"}
            </Button>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Root>
      <div className="flex flex-col gap-4 px-3 pb-8 pt-3 sm:px-5">
        <PageHeader
          title="审核列表"
          description="查看你已上传资源的审核状态"
          icon={<ListMagnifyingGlassIcon size={25} className="text-purple-300" />}
          action={
            <div className="flex flex-wrap items-center gap-2">
              {selectMode ? (
                <>
                  <span className="shrink-0 text-sm text-white/70">
                    已选 {selectedNumbers.size} 项
                  </span>
                  <Button
                    size="1"
                    variant="soft"
                    color="gray"
                    disabled={selectedNumbers.size === 0 || bulkHiding}
                    onClick={() => setBulkHideDialogOpen(true)}
                  >
                    <EyeSlashIcon size={15} weight="bold" />
                    {bulkHiding ? "隐藏中..." : "隐藏所选"}
                  </Button>
                  <Button
                    size="1"
                    variant="ghost"
                    color="gray"
                    disabled={bulkHiding}
                    onClick={exitSelectMode}
                  >
                    取消
                  </Button>
                </>
              ) : (
                <>
                  {hiddenCount > 0 && (
                    <Button
                      size="1"
                      variant="soft"
                      color="gray"
                      onClick={() => setShowHidden((prev) => !prev)}
                    >
                      {showHidden ? (
                        <EyeSlashIcon size={15} weight="bold" />
                      ) : (
                        <EyeIcon size={15} weight="bold" />
                      )}
                      {showHidden ? "收起已隐藏" : `显示已隐藏（${hiddenCount}）`}
                    </Button>
                  )}
                  <Button
                    size="1"
                    variant="ghost"
                    color="gray"
                    disabled={loading || hideableCount === 0}
                    onClick={enterSelectMode}
                  >
                    <CheckSquareIcon size={15} weight="bold" />
                    批量管理
                  </Button>
                  {!viewMode.mobile && (
                    <SegmentedControl.Root
                      value={viewMode.mode === "table" ? "table" : "card"}
                      onValueChange={(value) =>
                        viewMode.setMode(value as "table" | "card")
                      }
                      size="1"
                      variant="surface"
                      radius="large"
                    >
                      <SegmentedControl.Item
                        value="table"
                        className="cursor-pointer px-3 py-1.5 text-xs"
                      >
                        表格
                      </SegmentedControl.Item>
                      <SegmentedControl.Item
                        value="card"
                        className="cursor-pointer px-3 py-1.5 text-xs"
                      >
                        卡片
                      </SegmentedControl.Item>
                    </SegmentedControl.Root>
                  )}
                  <Button variant="soft" onClick={() => navigate("/new-resource")}>
                    <FileArrowUpIcon size={15} weight="fill" />
                    发布资源
                  </Button>
                </>
              )}
            </div>
          }
        />

        <div className="mx-auto w-full max-w-6xl">
          {content}
          {!loading && !error && visibleData.length > 0 && viewMode.resolved === "table" && (
            <div className="w-full overflow-x-auto rounded-xl bg-nav-item p-0.5 scrollbar-thin scrollbar-thumb-neutral-600 scrollbar-track-neutral-800">
              <Table.Root className="pt-1.5 min-w-max">
                <Table.Header>
                  <Table.Row>
                    {selectMode && (
                      <Table.ColumnHeaderCell className="w-10" />
                    )}
                    <Table.ColumnHeaderCell>唯一标识</Table.ColumnHeaderCell>
                    <Table.ColumnHeaderCell>名称</Table.ColumnHeaderCell>
                    <Table.ColumnHeaderCell>类型</Table.ColumnHeaderCell>
                    <Table.ColumnHeaderCell>状态</Table.ColumnHeaderCell>
                    <Table.ColumnHeaderCell>提交日期</Table.ColumnHeaderCell>
                    <Table.ColumnHeaderCell>操作</Table.ColumnHeaderCell>
                  </Table.Row>
                </Table.Header>
                <Table.Body>
                  {visibleData.map((item) => {
                    const hideable = isHideable(item);
                    const selected = selectedNumbers.has(item.prNumber);
                    return (
                      <Table.Row
                        key={`${item.prNumber}-${item.id}`}
                        className={
                          selectMode
                            ? hideable
                              ? "hover:bg-neutral-700 active:bg-neutral-700 cursor-pointer"
                              : "cursor-not-allowed"
                            : item.prState !== "merged"
                              ? "hover:bg-neutral-700 active:bg-neutral-700 cursor-pointer"
                              : ""
                        }
                        onClick={() => {
                          if (!selectMode) {
                            void handleSelect(item);
                            return;
                          }
                          if (hideable) toggleSelect(item.prNumber);
                        }}
                      >
                        {selectMode && (
                          <Table.Cell>
                            <button
                              type="button"
                              aria-label={
                                hideable
                                  ? selected
                                    ? "取消选择该 PR"
                                    : "选择该 PR"
                                  : "只有已关闭的 PR 可以隐藏"
                              }
                              aria-pressed={selected}
                              disabled={!hideable}
                              title={
                                hideable ? undefined : "只有已关闭的 PR 可以隐藏"
                              }
                              onClick={(event) => {
                                event.stopPropagation();
                                if (hideable) toggleSelect(item.prNumber);
                              }}
                              className={`flex h-5 w-5 items-center justify-center rounded-[6px] border transition-colors ${
                                selected
                                  ? "border-white/70 bg-white text-neutral-900"
                                  : "border-white/30 bg-transparent text-transparent"
                              } ${hideable ? "cursor-pointer" : "cursor-not-allowed opacity-40"}`}
                            >
                              <CheckIcon size={13} weight="bold" />
                            </button>
                          </Table.Cell>
                        )}
                        <Table.RowHeaderCell>{item.id}</Table.RowHeaderCell>
                        <Table.Cell>{item.name}</Table.Cell>
                        <Table.Cell>
                          {formatResourceType(item.restype)}
                        </Table.Cell>
                        <Table.Cell className="flex flex-row gap-1 items-center">
                          {statusRender(item)}
                          {item.kind === "delete" && (
                            <Badge color="red" variant="soft">
                              删除申请
                            </Badge>
                          )}
                          {item.hidden && (
                            <Badge color="gray" variant="soft">
                              已隐藏
                            </Badge>
                          )}
                        </Table.Cell>
                        <Table.Cell>
                          {item.createdAt
                            ? new Date(item.createdAt).toLocaleDateString(
                                "zh-CN",
                              )
                            : "--"}
                        </Table.Cell>
                        <Table.Cell>
                          {selectMode ? (
                            <span className="text-xs text-white/45">
                              {hideable
                                ? selected
                                  ? "已选择"
                                  : "可隐藏"
                                : "不可隐藏"}
                            </span>
                          ) : (
                            <div className="flex flex-wrap items-center gap-1.5">
                              {selectingPr === item.prNumber ? (
                                <span className="inline-flex items-center gap-1 text-xs text-white/50">
                                  <Spinner size="1" /> 载入中...
                                </span>
                              ) : null}
                              {item.prState === "closed" ? (
                                item.hidden ? (
                                  <Button
                                    size="1"
                                    variant="soft"
                                    color="gray"
                                    disabled={visibilityBusy === item.prNumber}
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      void handleUnhide(item.prNumber);
                                    }}
                                  >
                                    <EyeIcon size={14} weight="bold" />
                                    {visibilityBusy === item.prNumber
                                      ? "恢复中..."
                                      : "恢复显示"}
                                  </Button>
                                ) : !item.refused ? (
                                  <Button
                                    size="1"
                                    variant="soft"
                                    color="blue"
                                    disabled={reopening === item.prNumber}
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      void handleReopen(item);
                                    }}
                                  >
                                    <ArrowClockwiseIcon
                                      size={14}
                                      weight="bold"
                                    />
                                    {reopening === item.prNumber
                                      ? "重新打开中..."
                                      : "重新打开"}
                                  </Button>
                                ) : null
                              ) : null}
                            </div>
                          )}
                        </Table.Cell>
                      </Table.Row>
                    );
                  })}
                </Table.Body>
              </Table.Root>
            </div>
          )}
          {!loading && !error && visibleData.length > 0 && viewMode.resolved === "card" && (
            <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2">
              {visibleData.map((item) => (
                <PublishResourceCard
                  key={`${item.prNumber}-${item.id}`}
                  item={item}
                  selecting={selectingPr === item.prNumber}
                  reopening={reopening === item.prNumber}
                  visibilityBusy={visibilityBusy === item.prNumber}
                  selectable={selectMode}
                  selected={selectedNumbers.has(item.prNumber)}
                  hideable={isHideable(item)}
                  onToggleSelect={() => toggleSelect(item.prNumber)}
                  onSelect={() => void handleSelect(item)}
                  onReopen={() => void handleReopen(item)}
                  onUnhide={() => void handleUnhide(item.prNumber)}
                />
              ))}
            </div>
          )}
          {!loading && !error && hasMore && (
            <div className="mt-3 flex justify-center">
              <Button
                variant="soft"
                color="gray"
                disabled={loadingMore}
                onClick={() => void loadMore()}
              >
                {loadingMore ? (
                  <Spinner size="1" />
                ) : (
                  <ArrowDownIcon size={15} weight="bold" />
                )}
                {loadingMore ? "加载中..." : "加载更多"}
              </Button>
            </div>
          )}
        </div>
      </div>
    </Page>
  );
}

/**
 * 手机/卡片视图：名称是主要辨识依据，ID 次要；状态与 PR 号放在下方。
 * 已合入的卡片不可点击；已关闭的卡片提供「重新打开」与「隐藏」，
 * 被隐藏的卡片（仅在「显示已隐藏」开启时出现）提供「恢复显示」。
 */
function PublishResourceCard({
  item,
  selecting,
  reopening,
  visibilityBusy,
  selectable,
  selected,
  hideable,
  onToggleSelect,
  onSelect,
  onReopen,
  onUnhide,
}: {
  item: PublishingResource;
  selecting: boolean;
  reopening: boolean;
  visibilityBusy: boolean;
  selectable: boolean;
  selected: boolean;
  hideable: boolean;
  onToggleSelect: () => void;
  onSelect: () => void;
  onReopen: () => void;
  onUnhide: () => void;
}) {
  const merged = item.prState === "merged";
  const entry = item.catalog.entry;
  const interactive = !merged;

  return (
    <div
      role="button"
      tabIndex={interactive ? 0 : -1}
      aria-disabled={merged || undefined}
      onClick={
        merged
          ? undefined
          : selectable
            ? () => {
                if (hideable) onToggleSelect();
              }
            : onSelect
      }
      onKeyDown={(event) => {
        if (!interactive) return;
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          if (selectable) {
            if (hideable) onToggleSelect();
          } else {
            onSelect();
          }
        }
      }}
      className={`h-full rounded-xl border border-white/10 bg-nav-item px-3.5 py-3 outline-none transition-colors ${
        merged
          ? "cursor-default opacity-75"
          : selectable && !hideable
            ? "cursor-not-allowed opacity-60"
            : "cursor-pointer hover:bg-nav-item-hover focus-visible:ring-2 focus-visible:ring-purple-400/60"
      } ${selecting ? "pointer-events-none opacity-60" : ""} ${
        item.hidden ? "opacity-60" : ""
      }`}
    >
      <div className="flex items-start gap-3">
        <ResourceIcon
          rawUrl={indexItemIconUrl(entry)}
          className="size-10 rounded-full border border-white/10"
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <p className="line-clamp-2 min-w-0 text-sm font-semibold leading-5 text-white">
              {item.name}
            </p>
            <div className="flex shrink-0 items-center gap-1">
              <Badge color="gray" variant="soft">
                {formatResourceType(item.restype)}
              </Badge>
              {item.prUrl && (
                <button
                  type="button"
                  aria-label={`在 GitHub 查看 PR #${item.prNumber}`}
                  title={`在 GitHub 查看 PR #${item.prNumber}`}
                  className="rounded p-0.5 text-white/30 transition-colors hover:bg-white/10 hover:text-white/70"
                  onClick={(event) => {
                    event.stopPropagation();
                    openExternal(item.prUrl!);
                  }}
                >
                  <GithubLogoIcon size={15} weight="duotone" />
                </button>
              )}
            </div>
          </div>

          <div className="mt-1 flex min-w-0 items-center gap-1.5">
            <span className="min-w-0 truncate font-mono text-xs text-white/45">
              {item.id}
            </span>
            <button
              type="button"
              aria-label="复制资源 ID"
              title="复制资源 ID"
              className="shrink-0 rounded p-0.5 text-white/35 transition-colors hover:bg-white/10 hover:text-white/70"
              onClick={(event) => {
                event.stopPropagation();
                void navigator.clipboard.writeText(item.id).then(
                  () => toast.success("已复制"),
                  () => toast.error("复制失败"),
                );
              }}
            >
              <CopyIcon size={13} />
            </button>
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
            {statusRender(item)}
            {item.kind === "delete" && (
              <Badge color="red" variant="soft">
                删除申请
              </Badge>
            )}
            {item.hidden && (
              <Badge color="gray" variant="soft">
                已隐藏
              </Badge>
            )}
            {selecting ? (
              <span className="inline-flex items-center gap-1 text-xs text-white/50">
                <Spinner size="1" /> 载入中...
              </span>
            ) : null}
          </div>

          <div className="mt-1 text-xs text-white/40">
            提交于{" "}
            {item.createdAt
              ? new Date(item.createdAt).toLocaleDateString("zh-CN")
              : "--"}
          </div>

          {selectable ? (
            <div className="mt-2 flex items-center gap-2 border-t border-white/10 pt-2">
              <button
                type="button"
                aria-label={
                  hideable
                    ? selected
                      ? "取消选择该 PR"
                      : "选择该 PR"
                    : "只有已关闭的 PR 可以隐藏"
                }
                aria-pressed={hideable ? selected : undefined}
                disabled={!hideable}
                title={hideable ? undefined : "只有已关闭的 PR 可以隐藏"}
                onClick={(event) => {
                  event.stopPropagation();
                  if (hideable) onToggleSelect();
                }}
                className={`flex items-center gap-2 rounded-md text-xs transition-colors ${
                  hideable
                    ? "cursor-pointer text-white/70 hover:text-white"
                    : "cursor-not-allowed text-white/35"
                }`}
              >
                <span
                  aria-hidden="true"
                  className={`flex h-5 w-5 items-center justify-center rounded-[6px] border transition-colors ${
                    selected
                      ? "border-white/70 bg-white text-neutral-900"
                      : "border-white/30 bg-transparent text-transparent"
                  } ${hideable ? "" : "opacity-40"}`}
                >
                  <CheckIcon size={13} weight="bold" />
                </span>
                {hideable
                  ? selected
                    ? "已选择"
                    : "选择该 PR"
                  : "只有已关闭的 PR 可以隐藏"}
              </button>
            </div>
          ) : item.prState === "closed" ? (
            <div className="mt-2 flex flex-wrap justify-end gap-1.5">
              {item.hidden ? (
                <Button
                  size="1"
                  variant="soft"
                  color="gray"
                  disabled={visibilityBusy}
                  onClick={(event) => {
                    event.stopPropagation();
                    onUnhide();
                  }}
                >
                  <EyeIcon size={14} weight="bold" />
                  {visibilityBusy ? "恢复中..." : "恢复显示"}
                </Button>
              ) : !item.refused ? (
                <Button
                  size="1"
                  variant="soft"
                  color="blue"
                  disabled={reopening}
                  onClick={(event) => {
                    event.stopPropagation();
                    onReopen();
                  }}
                >
                  <ArrowClockwiseIcon size={14} weight="bold" />
                  {reopening ? "重新打开中..." : "重新打开"}
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
