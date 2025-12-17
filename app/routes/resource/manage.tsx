import {
  ArchiveIcon,
  FileArrowUpIcon,
  ListMagnifyingGlassIcon,
} from "@phosphor-icons/react";
import { Button, Table, Callout, Spinner, Tabs } from "@radix-ui/themes";
import { useNavigate } from "react-router";
import Page from "~/layout/page";
import {
  loadOwnedCatalogResourcesForCurrentUser,
  type ResourceCatalogContext,
  type ResourceEditContext,
} from "~/logic/publish/resources";
import ResourcePublish from "./publish";
import { SectionCard } from "./publish/components/shared";
import { useLayoutEffect, useEffect, useRef, useState } from "react";

function formatRestype(restype: string) {
  if (restype === "quick_app") return "快应用";
  if (restype === "watchface") return "表盘";
  return restype || "未知";
}

function useElementWidth() {
  const ref = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState<number | null>(null);

  useLayoutEffect(() => {
    if (!ref.current) return;

    const el = ref.current;

    const update = () => {
      setWidth(el.getBoundingClientRect().width);
    };

    update();

    const ro = new ResizeObserver(update);
    ro.observe(el);

    return () => ro.disconnect();
  }, []);

  return { ref, width };
}

export default function ResourceManage() {
  const navigate = useNavigate();
  const [items, setItems] = useState<ResourceCatalogContext[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectError, setSelectError] = useState("");
  const { ref, width } = useElementWidth();

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
      <div className="z-1 min-[1024px]:bg-linear-to-t max-[1024px]:bg-linear-to-b min-[1024px]:top-[calc(44px+16px)] max-[1024px]:bottom-0 from-0% from-bg/0 to-65% min-[1024px]:to-[rgb(17,17,19)] max-[1024px]:to-[rgba(17,17,19,0.75)] fixed inset-x-0 min-[1024px]:h-14 max-[1024px]:h-16" />
      <Tabs.Root defaultValue="manage">
        <div
          style={width ? { width: width } : { width: "100vw" }}
          className={`z-2 pb-[calc(env(safe-area-inset-bottom)+0.5rem)] fixed bottom-0 flex justify-center min-[1024px]:top-0 min-[1024px]:sticky min-[1024px]:w-full!`}
        >
          <Tabs.List
            className={`rounded-full flex gap-0.5 space-x-2 p-1 shadow-[0px_2px_4px_#111113]! justify-center w-fit! mx-auto bg-[rgba(17,17,19,0.5)] border border-white/10 backdrop-blur-xl`}
          >
            <Tabs.Trigger
              value="manage"
              className="
                      px-1.5! py-1! font-medium text-white/50!
                      rounded-full!
                      transition!
                      data-[state=active]:bg-nav-item!
                      data-[state=active]:text-white!
                      hover:bg-nav-item/75!
                      data-[state=active]:hover:bg-nav-item-selected!
                      before:content-none!
                      h-fit!
                      active:scale-95!
                      *:hover:bg-transparent!
                      *:active:bg-transparent!
                      *:focus:bg-transparent!
                      *:bg-transparent!
                      *:flex! *:gap-1! *:items-center!
                    "
            >
              <ArchiveIcon size={22} />
              已发布资源
            </Tabs.Trigger>
            <Tabs.Trigger
              value="publish"
              className="
                      px-1.5! py-1! font-medium text-white/50!
                      rounded-full!
                      transition!
                      data-[state=active]:bg-nav-item!
                      data-[state=active]:text-white!
                      hover:bg-nav-item/75!
                      data-[state=active]:hover:bg-nav-item-selected!
                      before:content-none!
                      h-fit!
                      active:scale-95!
                      *:hover:bg-transparent!
                      *:active:bg-transparent!
                      *:focus:bg-transparent!
                      *:bg-transparent!
                      *:flex! *:gap-1! *:items-center!
                    "
            >
              <ListMagnifyingGlassIcon size={22} />
              审核列表
            </Tabs.Trigger>
          </Tabs.List>
        </div>
        <div
          className="flex flex-col gap-2 max-w-6xl mx-auto w-full pb-[54px]"
          ref={ref}
        >
          <Tabs.Content value="manage">
            <SectionCard
              title="已发布资源"
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
                  className="-mb-2 bg-transparent! p-3!"
                >
                  <Callout.Icon>
                    <Spinner size="2" />
                  </Callout.Icon>
                  <Callout.Text className="font-semibold text-white/45">
                    正在载入资源目录...
                  </Callout.Text>
                </Callout.Root>
              )}
              {error && (
                <p className="text-sm text-amber-400">加载失败：{error}</p>
              )}
              {!loading && !error && items.length === 0 && (
                <p className="text-sm text-white/70">暂无已发布的资源。</p>
              )}
              {!loading && !error && items.length > 0 && (
                <div className="p-0.5 w-full overflow-x-auto scrollbar-thin scrollbar-thumb-neutral-600 scrollbar-track-neutral-800">
                  <Table.Root className="pt-1.5 min-w-max">
                    <Table.Header>
                      <Table.Row>
                        <Table.ColumnHeaderCell>
                          唯一标识
                        </Table.ColumnHeaderCell>
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
                          <Table.RowHeaderCell>
                            {item.entry.id}
                          </Table.RowHeaderCell>
                          <Table.Cell>{item.entry.name}</Table.Cell>
                          <Table.Cell>
                            {formatRestype(item.entry.restype)}
                          </Table.Cell>
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
          </Tabs.Content>

          <Tabs.Content value="publish">
            <ResourcePublish />
          </Tabs.Content>
        </div>
      </Tabs.Root>
    </Page>
  );
}
