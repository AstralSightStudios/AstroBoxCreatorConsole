import {
  ArchiveIcon,
  WarningOctagonIcon,
  TrayIcon,
} from "@phosphor-icons/react";
import { Table, Callout, Spinner } from "@radix-ui/themes";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import PageHeader from "~/components/page-header";
import Page from "~/layout/page";
import { loadAccountState } from "~/logic/account/store";
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
    if (catalog.entry.id?.includes("LegacyItem")) {
      setSelectError("旧版资源（LegacyItem）暂不支持在控制台编辑。");
      return;
    }
    if (selectingId) return;
    const editContext: ResourceEditContext = {
      mode: "catalog",
      catalog,
    };
    setSelectingId(catalog.entry.id);
    try {
      const token = loadAccountState().github?.token;
      if (token) {
        const open = await findOpenSubmissionForResourceId(
          token,
          catalog.entry.id,
        );
        if (open) {
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
    }
    navigate("/manage/edit", { state: { editContext } });
  };

  return (
    <Page>
      <div className="flex flex-col gap-4 px-3 pb-8 pt-3 sm:px-5">
        <PageHeader
          title="已发布资源"
          description="管理已通过审核的资源"
          icon={<ArchiveIcon size={25} className="text-purple-300" />}
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
            <Callout.Root color="gray" variant="soft" highContrast>
              <Callout.Icon>
                <Spinner size="2" />
              </Callout.Icon>
              <Callout.Text className="font-semibold text-white/45">
                正在载入资源目录...
              </Callout.Text>
            </Callout.Root>
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
          {!loading && !error && items.length > 0 && (
            <div className="w-full overflow-x-auto rounded-xl bg-nav-item p-0.5 scrollbar-thin scrollbar-thumb-neutral-600 scrollbar-track-neutral-800">
              <Table.Root className="min-w-max pt-1.5">
                <Table.Header>
                  <Table.Row>
                    <Table.ColumnHeaderCell>唯一标识</Table.ColumnHeaderCell>
                    <Table.ColumnHeaderCell>名称</Table.ColumnHeaderCell>
                    <Table.ColumnHeaderCell>类型</Table.ColumnHeaderCell>
                    <Table.ColumnHeaderCell>仓库</Table.ColumnHeaderCell>
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
                    </Table.Row>
                  ))}
                </Table.Body>
              </Table.Root>
            </div>
          )}
          <p className="px-3.5 pt-1.5 text-xs text-white/60">
            旧版资源（LegacyItem）暂不支持在控制台编辑，您仍需要按照 v1
            操作方式修改它们。
          </p>
        </div>
      </div>
    </Page>
  );
}
