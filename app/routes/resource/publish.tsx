import {
  ArrowClockwiseIcon,
  CheckCircleIcon,
  ClockIcon,
  FileArrowUpIcon,
  PencilSimpleIcon,
  WarningOctagonIcon,
} from "@phosphor-icons/react";
import { AlertDialog, Button, Table, Callout, Spinner } from "@radix-ui/themes";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import Page from "~/layout/page";
import {
  createPullRequestComment,
  reopenPullRequest,
} from "~/api/github/pr-review";
import {
  loadInProgressResourcesForCurrentUser,
  type PublishingResource,
  type ResourceEditContext,
} from "~/logic/publish/resources";

import { SectionCard } from "./publish/components/shared";

function formatRestype(restype: string) {
  if (restype === "quick_app") return "快应用";
  if (restype === "watchface") return "表盘";
  return restype || "未知";
}

function useInProgressResources(refreshTick: number) {
  const [data, setData] = useState<PublishingResource[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    const run = async () => {
      setLoading(true);
      setError("");
      try {
        const result = await loadInProgressResourcesForCurrentUser();
        if (active) setData(result);
      } catch (err) {
        if (active) {
          setError((err as Error).message || "加载失败");
        }
      } finally {
        if (active) setLoading(false);
      }
    };
    run();
    return () => {
      active = false;
    };
  }, [refreshTick]);

  return { data, loading, error };
}

export default function ResourcePublish() {
  const navigate = useNavigate();
  const [refreshTick, setRefreshTick] = useState(0);
  const [reopening, setReopening] = useState<number | null>(null);
  const [refuseTarget, setRefuseTarget] = useState<PublishingResource | null>(
    null,
  );
  const { data, loading, error } = useInProgressResources(refreshTick);

  const statusRender = (resource: PublishingResource) => {
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
  };

  const handleSelect = (resource: PublishingResource) => {
    if (resource.refused) {
      setRefuseTarget(resource);
      return;
    }
    if (resource.prState === "merged") return;
    const editContext: ResourceEditContext = {
      mode: "in_progress",
      catalog: resource.catalog,
      prNumber: resource.prNumber,
      prUrl: resource.prUrl,
      prState: resource.prState,
      prHead: resource.prHead,
      reviewState: resource.status,
      needs: resource.needs,
      submission: resource.submission,
    };
    navigate("/publish/edit", { state: { editContext } });
  };

  const handleReopen = async (resource: PublishingResource) => {
    if (reopening !== null) return;
    setReopening(resource.prNumber);
    try {
      await reopenPullRequest(resource.prNumber);
      await createPullRequestComment(
        resource.prNumber,
        "[ABCC_REOPEN] 创作者已重新打开此 PR。",
      );
      toast.success("PR 已重新打开，并已记录 REOPEN 标签。");
      setRefreshTick((prev) => prev + 1);
    } catch (err) {
      toast.error((err as Error).message || "重新打开 PR 失败");
    } finally {
      setReopening(null);
    }
  };

  const content = useMemo(() => {
    if (loading) {
      return (
        <Callout.Root
          color="gray"
          variant="soft"
          highContrast
          className="-mb-2.5 bg-transparent! p-3!"
        >
          <Callout.Icon>
            <Spinner size="2" />
          </Callout.Icon>
          <Callout.Text className="font-semibold text-white/45">
            <span>正在载入申请列表...</span>
          </Callout.Text>
        </Callout.Root>
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
    if (data.length === 0) {
      return (
        <p className="px-3 text-sm text-white/70">
          暂无发布申请，点击下方按钮开始新的提交。
        </p>
      );
    }
    return (
      <div className="w-full overflow-x-auto scrollbar-thin scrollbar-thumb-neutral-600 scrollbar-track-neutral-800">
        <Table.Root className="pt-1.5 min-w-max">
          <Table.Header>
            <Table.Row>
              <Table.ColumnHeaderCell>唯一标识</Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell>名称</Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell>类型</Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell>状态</Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell>提交日期</Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell>操作</Table.ColumnHeaderCell>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {data.map((item) => (
                <Table.Row
                  key={`${item.prNumber}-${item.id}`}
                className={
                  item.prState !== "merged"
                    ? "hover:bg-neutral-700 active:bg-neutral-700 cursor-pointer"
                    : ""
                }
                onClick={() => handleSelect(item)}
              >
                <Table.RowHeaderCell>{item.id}</Table.RowHeaderCell>
                <Table.Cell>{item.name}</Table.Cell>
                <Table.Cell>{formatRestype(item.restype)}</Table.Cell>
                <Table.Cell className="flex flex-row gap-1 items-center">
                  {statusRender(item)}
                </Table.Cell>
                <Table.Cell>
                  {item.createdAt
                    ? new Date(item.createdAt).toLocaleDateString("zh-CN")
                    : "--"}
                </Table.Cell>
                <Table.Cell>
                  {item.prState === "closed" && !item.refused ? (
                    <Button
                      size="1"
                      variant="soft"
                      color="blue"
                      disabled={reopening === item.prNumber}
                      onClick={(e) => {
                        e.stopPropagation();
                        void handleReopen(item);
                      }}
                    >
                      <ArrowClockwiseIcon size={14} weight="bold" />
                      {reopening === item.prNumber ? "重新打开中..." : "重新打开"}
                    </Button>
                  ) : null}
                </Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table.Root>
      </div>
    );
  }, [data, error, handleSelect, loading]);

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
      <SectionCard
        title="审核列表"
        description="查看你已上传资源的审核状态"
        padding={false}
      >
        <div className="p-0.5">{content}</div>
        <Button
          className="border border-white/10 p-3! min-h-9! flex items-center mx-2! mb-2!"
          onClick={() => navigate("/publish/new")}
          size="2"
          radius="large"
          variant="soft"
        >
          <FileArrowUpIcon size={18} weight="fill" /> 发布资源
        </Button>
      </SectionCard>
    </Page>
  );
}
