import {
  ArchiveIcon,
  CopyIcon,
  WarningOctagonIcon,
  TrayIcon,
} from "@phosphor-icons/react";
import {
  Table,
  Callout,
  Spinner,
  Badge,
  Dialog,
  SegmentedControl,
} from "~/components/ScaleAwareThemes";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import PageHeader from "~/components/page-header";
import Page from "~/layout/page";
import { DeleteResourceDialog } from "~/components/resource/DeleteResourceDialog";
import { ResourceActionMenu } from "~/components/resource/ResourceActionMenu";
import { useListViewMode } from "~/logic/ui/list-view-mode";
import { indexItemIconUrl } from "~/logic/catalog/index-v2";
import { ResourceIcon } from "~/routes/manage-resources/components/ResourceVisuals";
import { loadAccountState } from "~/logic/account/store";
import { isLegacyItemId } from "~/logic/publish/resource-deletion";
import {
  loadOwnedCatalogResourcesForCurrentUser,
  buildInProgressEditContextFromPr,
  type ResourceCatalogContext,
  type ResourceEditContext,
} from "~/logic/publish/resources";
import { findOpenSubmissionForResourceId } from "~/logic/publish/staging-submission";
import { useEffect, useState } from "react";
import { formatResourceType } from "~/logic/publish/resource-type";

export default function ResourceManage() {
  const navigate = useNavigate();
  const [items, setItems] = useState<ResourceCatalogContext[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectError, setSelectError] = useState("");
  const [selectingId, setSelectingId] = useState<string | null>(null);
  const [selectProgress, setSelectProgress] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] =
    useState<ResourceCatalogContext | null>(null);
  const viewMode = useListViewMode("resource-manage-view");

  useEffect(() => {
    let active = true;
    const run = async () => {
      setLoading(true);
      setError("");
      try {
        const data = await loadOwnedCatalogResourcesForCurrentUser();
        if (active) setItems(data);
      } catch (err) {
        if (active) setError((err as Error).message || "加载失败");
      } finally {
        if (active) setLoading(false);
      }
    };
    run();
    return () => {
      active = false;
    };
  }, []);

  const handleSelect = async (catalog: ResourceCatalogContext) => {
    setSelectError("");
    if (isLegacyItemId(catalog.entry.id)) {
      setSelectError("旧版资源（LegacyItem）暂不支持在控制台编辑。");
      return;
    }
    if (selectingId) return;
    const editContext: ResourceEditContext = {
      mode: "catalog",
      catalog,
    };
    setSelectingId(catalog.entry.id);
    setSelectProgress("正在检查进行中的提交…");
    try {
      const token = loadAccountState().github?.token;
      if (token) {
        const open = await findOpenSubmissionForResourceId(
          token,
          catalog.entry.id,
          ({ done, total }) => {
            if (total > 0) {
              setSelectProgress(
                `正在检查进行中的提交（${done}/${total}）…`,
              );
            }
          },
        );
        if (open) {
          if (open.mode === "delete") {
            toast.warning(
              `资源「${catalog.entry.name}」已有进行中的删除申请 PR #${open.prNumber}，处理进度请前往审核列表查看。`,
            );
            return;
          }
          setSelectProgress("正在载入提交信息…");
          try {
            const username = loadAccountState().github?.username
              ?.trim()
              .toLowerCase();
            const opened = await buildInProgressEditContextFromPr({
              prNumber: open.prNumber,
              token,
            });
            const isOwn =
              !!username &&
              opened.authorLogin?.trim().toLowerCase() === username;
            if (!isOwn) {
              toast.warning(
                `资源「${catalog.entry.name}」已有他人进行中的提交 PR #${open.prNumber}《${open.prTitle}》，请等待其处理完成后再编辑。`,
              );
              return;
            }
            toast.warning(
              `资源「${catalog.entry.name}」已有进行中的提交 PR #${open.prNumber}《${open.prTitle}》，已为你打开该提交继续编辑。`,
            );
            setSelectProgress("正在打开编辑器…");
            navigate("/publish/edit", {
              state: { editContext: opened },
            });
            return;
          } catch (err) {
            toast.error(
              `资源「${catalog.entry.name}」存在进行中的提交 PR #${open.prNumber}，但载入其编辑信息失败：${
                (err as Error).message || "未知错误"
              }`,
            );
            return;
          }
        }
      }
    } catch {
      // 预检扫描失败不阻塞编辑，交给提交阶段的重复提交守卫兜底。
    } finally {
      setSelectingId(null);
      setSelectProgress(null);
    }
    navigate("/manage/edit", { state: { editContext } });
  };

  return (
    <Page>
      <Dialog.Root open={selectingId !== null}>
        <Dialog.Content
          className="max-w-[360px]"
          onEscapeKeyDown={(event) => event.preventDefault()}
          onInteractOutside={(event) => event.preventDefault()}
        >
          <Dialog.Title className="sr-only">正在处理</Dialog.Title>
          <div className="flex flex-col items-center gap-3 py-1">
            <Spinner size="3" />
            <Dialog.Description className="text-sm font-medium text-white/70">
              {selectProgress || "正在载入..."}
            </Dialog.Description>
          </div>
        </Dialog.Content>
      </Dialog.Root>
      <DeleteResourceDialog
        open={deleteTarget !== null}
        resource={deleteTarget}
        onOpenChange={(next) => {
          if (!next) setDeleteTarget(null);
        }}
      />
      <div className="flex flex-col gap-4 px-3 pb-8 pt-3 sm:px-5">
        <PageHeader
          title="已发布资源"
          description="管理已通过审核的资源"
          icon={<ArchiveIcon size={25} className="text-purple-300" />}
          action={
            viewMode.mobile ? undefined : (
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
            )
          }
        />

        <div className="mx-auto flex w-full max-w-6xl flex-col gap-2">
          {selectError && (
            <Callout.Root color="yellow" variant="soft" highContrast>
              <Callout.Icon>
                <WarningOctagonIcon size={16} weight="fill" />
              </Callout.Icon>
              <Callout.Text className="font-semibold text-white/45">
                {selectError}
              </Callout.Text>
            </Callout.Root>
          )}
          {loading && (
            <div
              className="flex flex-col items-center justify-center gap-2.5 px-3 py-8"
              role="status"
              aria-live="polite"
            >
              <Spinner size="2" />
              <span className="text-sm font-semibold text-white/45">
                正在载入资源目录...
              </span>
            </div>
          )}
          {error && (
            <Callout.Root color="red" variant="soft">
              <Callout.Icon>
                <WarningOctagonIcon size={16} weight="fill" />
              </Callout.Icon>
              <Callout.Text className="font-semibold">
                <p>加载失败：{error}</p>
              </Callout.Text>
            </Callout.Root>
          )}
          {!loading && !error && items.length === 0 && (
            <Callout.Root variant="soft">
              <Callout.Icon>
                <TrayIcon size={16} weight="fill" />
              </Callout.Icon>
              <Callout.Text className="font-semibold">
                <p>暂无已发布的资源</p>
              </Callout.Text>
            </Callout.Root>
          )}
          {!loading && !error && items.length > 0 && viewMode.resolved === "table" && (
            <div className="w-full overflow-x-auto rounded-xl bg-nav-item p-0.5 scrollbar-thin scrollbar-thumb-neutral-600 scrollbar-track-neutral-800">
              <Table.Root className="min-w-max pt-1.5">
                <Table.Header>
                  <Table.Row>
                    <Table.ColumnHeaderCell>唯一标识</Table.ColumnHeaderCell>
                    <Table.ColumnHeaderCell>名称</Table.ColumnHeaderCell>
                    <Table.ColumnHeaderCell>类型</Table.ColumnHeaderCell>
                    <Table.ColumnHeaderCell>仓库</Table.ColumnHeaderCell>
                    <Table.ColumnHeaderCell>操作</Table.ColumnHeaderCell>
                  </Table.Row>
                </Table.Header>
                <Table.Body>
                  {items.map((item) => (
                    <Table.Row
                      key={item.entry.id}
                      className={`cursor-pointer hover:bg-neutral-700 active:bg-neutral-700 ${
                        selectingId === item.entry.id
                          ? "pointer-events-none opacity-60"
                          : ""
                      }`}
                      onClick={() => void handleSelect(item)}
                    >
                      <Table.RowHeaderCell className="flex items-center gap-2">
                        {selectingId === item.entry.id ? <Spinner size="1" /> : null}
                        <span>{item.entry.id}</span>
                      </Table.RowHeaderCell>
                      <Table.Cell>{item.entry.name}</Table.Cell>
                      <Table.Cell>{formatResourceType(item.entry.restype)}</Table.Cell>
                      <Table.Cell>
                        {item.entry.repo_owner}/{item.entry.repo_name}
                      </Table.Cell>
                      <Table.Cell>
                        <ResourceActionMenu
                          item={item}
                          disabled={selectingId !== null}
                          onEdit={() => void handleSelect(item)}
                          onDelete={() => setDeleteTarget(item)}
                        />
                      </Table.Cell>
                    </Table.Row>
                  ))}
                </Table.Body>
              </Table.Root>
            </div>
          )}
          {!loading && !error && items.length > 0 && viewMode.resolved === "card" && (
            <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2">
              {items.map((item) => (
                <ManageResourceCard
                  key={item.entry.id}
                  item={item}
                  selecting={selectingId === item.entry.id}
                  onSelect={() => void handleSelect(item)}
                  onDelete={() => setDeleteTarget(item)}
                />
              ))}
            </div>
          )}
          {!loading &&
            !error &&
            items.some((item) => isLegacyItemId(item.entry.id)) && (
              <p className="px-3.5 pt-1.5 text-xs text-white/60">
                旧版资源（LegacyItem）暂不支持在控制台编辑，您仍需要按照 v1
                操作方式修改它们。
              </p>
            )}
        </div>
      </div>
    </Page>
  );
}

const PAID_TYPE_LABELS: Record<string, string> = {
  free: "免费",
  paid: "付费",
  force_paid: "强制付费",
};

function paidTypeLabel(paidType: string): string {
  const normalized = paidType.trim() || "free";
  return PAID_TYPE_LABELS[normalized] ?? normalized;
}

/**
 * 手机/卡片视图：名称是主要辨识依据，ID 次要；仓库与编辑入口靠后。
 * 整卡点击进入编辑，右上角操作菜单用于编辑/打开仓库/删除。
 */
function ManageResourceCard({
  item,
  selecting,
  onSelect,
  onDelete,
}: {
  item: ResourceCatalogContext;
  selecting: boolean;
  onSelect: () => void;
  onDelete: () => void;
}) {
  const entry = item.entry;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return;
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect();
        }
      }}
      className={`h-full cursor-pointer rounded-xl border border-white/10 bg-nav-item px-3.5 py-3 outline-none transition-colors hover:bg-nav-item-hover focus-visible:ring-2 focus-visible:ring-purple-400/60 ${
        selecting ? "pointer-events-none opacity-60" : ""
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
              {entry.name}
            </p>
            <ResourceActionMenu
              item={item}
              disabled={selecting}
              onEdit={onSelect}
              onDelete={onDelete}
            />
          </div>

          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <Badge color="gray" variant="soft">
              {formatResourceType(entry.restype)}
            </Badge>
            <Badge
              color={entry.paid_type.trim() === "free" ? "gray" : "amber"}
              variant="soft"
            >
              {paidTypeLabel(entry.paid_type)}
            </Badge>
            {selecting ? <Spinner size="1" /> : null}
          </div>

          <div className="mt-1 flex min-w-0 items-center gap-1.5">
            <span className="min-w-0 truncate font-mono text-xs text-white/45">
              {entry.id}
            </span>
            <button
              type="button"
              aria-label="复制资源 ID"
              title="复制资源 ID"
              className="shrink-0 rounded p-0.5 text-white/35 transition-colors hover:bg-white/10 hover:text-white/70"
              onClick={(event) => {
                event.stopPropagation();
                void navigator.clipboard.writeText(entry.id).then(
                  () => toast.success("已复制"),
                  () => toast.error("复制失败"),
                );
              }}
            >
              <CopyIcon size={13} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
