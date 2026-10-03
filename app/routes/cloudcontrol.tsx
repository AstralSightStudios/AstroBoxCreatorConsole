import { PackageIcon } from "@phosphor-icons/react";
import { Callout, Spinner, Table, TextField } from "@radix-ui/themes";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useEffect, useMemo, useRef, useState } from "react";
import PageHeader from "~/components/page-header";
import Page from "~/layout/page";
import {
  formatIndexPaidType,
  formatIndexResourceType,
  indexItemIconUrl,
  indexItemRepoUrl,
  parseIndexV2,
  type IndexV2Entry,
} from "~/logic/catalog/index-v2";
import { useCommunityRepoManageAccess } from "~/logic/account/repo-permission";
import { useProxiedMediaUrl } from "~/logic/media-proxy";
import { fetchCatalogEntries } from "~/logic/publish/catalog";
import { LoadingIndicator } from "~/routes/resreview/components/LoadingIndicator";
import { ReviewAccessMessage } from "~/routes/resreview/components/ReviewAccessMessage";

export default function CloudControl() {
  const access = useCommunityRepoManageAccess();
  const [entries, setEntries] = useState<IndexV2Entry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!access.allowed) return;
    let alive = true;
    setLoading(true);
    setError("");
    fetchCatalogEntries()
      .then((result) => {
        if (!alive) return;
        setEntries(parseIndexV2(result.csvContent));
      })
      .catch((err) => {
        if (!alive) return;
        setEntries([]);
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [access.allowed, access.repoLabel]);

  const visibleEntries = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    if (!keyword) return entries;
    return entries.filter((entry) => {
      return (
        entry.name.toLowerCase().includes(keyword) ||
        entry.id.toLowerCase().includes(keyword)
      );
    });
  }, [entries, query]);

  if (!access.loggedIn) {
    return (
      <ReviewAccessMessage
        title="资源管理"
        text="请先在侧边栏登录 GitHub 账号。"
      />
    );
  }

  if (access.checking) {
    return (
      <div className="grid h-full w-full place-items-center px-6">
        <LoadingIndicator
          text="正在确认仓库权限"
          hint="正在查询当前 GitHub 账号对社区仓库的权限"
        />
      </div>
    );
  }

  if (!access.allowed) {
    return (
      <ReviewAccessMessage
        title="资源管理"
        text={`当前 GitHub 账号没有 ${access.repoLabel} 的仓库管理权限。${access.error ? ` ${access.error}` : ""}`}
      />
    );
  }

  return (
    <Page>
      <div className="flex flex-col gap-4 px-3 pb-8 pt-3 sm:px-5">
        <PageHeader
          title="资源管理"
          description={`${access.repoLabel} 的 index_v2.csv。点击一行打开对应的 GitHub 仓库。`}
          icon={<PackageIcon size={25} className="text-purple-300" />}
        />

        <div className="mx-auto flex w-full max-w-6xl flex-col gap-3">
          <TextField.Root
            value={query}
            placeholder="搜索名称或 ID"
            onChange={(event) => setQuery(event.target.value)}
            disabled={loading || Boolean(error)}
          />
          {loading && (
            <Callout.Root color="gray" variant="soft" highContrast>
              <Callout.Icon>
                <Spinner size="2" />
              </Callout.Icon>
              <Callout.Text className="font-semibold text-white/45">
                正在载入 index_v2.csv...
              </Callout.Text>
            </Callout.Root>
          )}
          {error && (
            <Callout.Root color="red" variant="soft">
              <Callout.Icon>
                <PackageIcon size={16} weight="fill" />
              </Callout.Icon>
              <Callout.Text className="font-semibold">
                加载失败：{error}
              </Callout.Text>
            </Callout.Root>
          )}
          {!loading && !error && visibleEntries.length === 0 && (
            <Callout.Root variant="soft">
              <Callout.Text className="font-semibold">
                {entries.length === 0 ? "目录里没有资源" : "没有匹配的资源"}
              </Callout.Text>
            </Callout.Root>
          )}
          {!loading && !error && visibleEntries.length > 0 && (
            <div className="w-full overflow-x-auto rounded-xl bg-nav-item p-0.5">
              <Table.Root className="min-w-max pt-1.5">
                <Table.Header>
                  <Table.Row>
                    <Table.ColumnHeaderCell>图标</Table.ColumnHeaderCell>
                    <Table.ColumnHeaderCell>名称</Table.ColumnHeaderCell>
                    <Table.ColumnHeaderCell>ID</Table.ColumnHeaderCell>
                    <Table.ColumnHeaderCell>资源类型</Table.ColumnHeaderCell>
                    <Table.ColumnHeaderCell>付费类型</Table.ColumnHeaderCell>
                  </Table.Row>
                </Table.Header>
                <Table.Body>
                  {visibleEntries.map((entry, index) => (
                    <ResourceRow key={`${entry.id}-${index}`} entry={entry} />
                  ))}
                </Table.Body>
              </Table.Root>
            </div>
          )}
          {!loading && !error && entries.length > 0 && (
            <p className="px-1 text-xs text-white/50">
              {query.trim()
                ? `${visibleEntries.length} / ${entries.length} 个资源`
                : `${entries.length} 个资源`}
            </p>
          )}
        </div>
      </div>
    </Page>
  );
}

function ResourceRow({ entry }: { entry: IndexV2Entry }) {
  const openRepo = () => {
    const url = indexItemRepoUrl(entry);
    openUrl(url).catch(() => {
      window.open(url, "_blank", "noopener,noreferrer");
    });
  };

  return (
    <Table.Row
      className="cursor-pointer hover:bg-neutral-700 active:bg-neutral-700"
      tabIndex={0}
      onClick={openRepo}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          openRepo();
        }
      }}
    >
      <Table.Cell>
        <ResourceIcon rawUrl={indexItemIconUrl(entry)} />
      </Table.Cell>
      <Table.Cell>{entry.name}</Table.Cell>
      <Table.RowHeaderCell className="font-mono text-[13px]">
        {entry.id}
      </Table.RowHeaderCell>
      <Table.Cell>{formatIndexResourceType(entry.restype)}</Table.Cell>
      <Table.Cell>{formatIndexPaidType(entry.paid_type)}</Table.Cell>
    </Table.Row>
  );
}

function ResourceIcon({ rawUrl }: { rawUrl: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [active, setActive] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node || active || !rawUrl) return;
    if (typeof IntersectionObserver === "undefined") {
      setActive(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((item) => item.isIntersecting)) {
          setActive(true);
          observer.disconnect();
        }
      },
      { rootMargin: "160px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [active, rawUrl]);

  return (
    <span
      ref={ref}
      className="inline-flex size-8 items-center justify-center overflow-hidden rounded-md bg-white/5"
    >
      {active && rawUrl ? <LoadedIcon rawUrl={rawUrl} /> : null}
    </span>
  );
}

function LoadedIcon({ rawUrl }: { rawUrl: string }) {
  const url = useProxiedMediaUrl(rawUrl);
  if (!url) return null;
  return <img src={url} alt="" className="size-8 object-cover" />;
}
