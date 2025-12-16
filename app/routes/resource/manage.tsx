import { FileArrowUpIcon } from "@phosphor-icons/react";
import { Button, Table, Callout, Spinner } from "@radix-ui/themes";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import Page from "~/layout/page";
import {
  loadOwnedCatalogResourcesForCurrentUser,
  type ResourceCatalogContext,
  type ResourceEditContext,
} from "~/logic/publish/resources";
import ResourcePublish from "./publish";
import { SectionCard } from "./publish/components/shared";

function formatRestype(restype: string) {
  if (restype === "quick_app") return "快应用";
  if (restype === "watchface") return "表盘";
  return restype || "未知";
}

export default function ResourceManage() {
  const navigate = useNavigate();
  const [items, setItems] = useState<ResourceCatalogContext[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectError, setSelectError] = useState("");

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

  const handleSelect = (catalog: ResourceCatalogContext) => {
    setSelectError("");
    if (catalog.entry.id?.includes("LegacyItem")) {
      setSelectError("旧版资源（LegacyItem）暂不支持在控制台编辑。");
      return;
    }
    const editContext: ResourceEditContext = {
      mode: "catalog",
      catalog,
    };
    navigate("/manage/edit", { state: { editContext } });
  };

  return (
    <Page>
      <SectionCard
        title="我的资源"
        description="管理已通过审核的资源"
        padding={false}
      >
        {selectError && (
          <p className="mt-1 text-sm text-amber-400">{selectError}</p>
        )}
        {loading && (
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
              <p>正在载入资源目录...</p>
            </Callout.Text>
          </Callout.Root>
        )}
        {error && <p className="text-sm text-amber-400">加载失败：{error}</p>}
        {!loading && !error && items.length === 0 && (
          <p className="text-sm text-white/70">暂无已发布的资源。</p>
        )}
        {!loading && !error && items.length > 0 && (
          <div className="p-0.5 w-full overflow-x-auto scrollbar-thin scrollbar-thumb-neutral-600 scrollbar-track-neutral-800">
            <Table.Root className="pt-1.5 min-w-max">
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
                    className="hover:bg-neutral-700 active:bg-neutral-700 cursor-pointer"
                    onClick={() => handleSelect(item)}
                  >
                    <Table.RowHeaderCell>{item.entry.id}</Table.RowHeaderCell>
                    <Table.Cell>{item.entry.name}</Table.Cell>
                    <Table.Cell>{formatRestype(item.entry.restype)}</Table.Cell>
                    <Table.Cell>
                      {item.entry.repo_owner}/{item.entry.repo_name}
                    </Table.Cell>
                  </Table.Row>
                ))}
              </Table.Body>
            </Table.Root>
          </div>
        )}
        <div className="flex flex-col px-3.5 pb-3 pt-1.5 w-full">
          <p className="text-xs text-white/60">
            旧版资源（LegacyItem）暂不支持在控制台编辑，您仍需要按照 v1
            操作方式修改它们。
          </p>
        </div>
      </SectionCard>
    </Page>
  );
}
