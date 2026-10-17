import { GithubLogoIcon, PackageIcon } from "@phosphor-icons/react";
import { Callout, Spinner, TextField } from "@radix-ui/themes";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import PageHeader from "~/components/page-header";
import { useRepoEnv } from "~/config/repoEnv";
import Page from "~/layout/page";
import {
  indexItemIconUrl,
  indexItemRepoUrl,
  parseIndexV2,
  type IndexV2Entry,
} from "~/logic/catalog/index-v2";
import { useCommunityRepoManageAccess } from "~/logic/account/repo-permission";
import { fetchCatalogEntries } from "~/logic/publish/catalog";
import { LoadingIndicator } from "~/routes/resreview/components/LoadingIndicator";
import { ReviewAccessMessage } from "~/routes/resreview/components/ReviewAccessMessage";
import {
  openExternal,
  ResourceBadges,
  ResourceIcon,
} from "./components/ResourceVisuals";

export default function ManageResourcesPage() {
  const navigate = useNavigate();
  const env = useRepoEnv();
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

  // index_v2.csv 把新资源追加在文件末尾，这里倒序让最新的资源排在前面。
  const orderedEntries = useMemo(() => [...entries].reverse(), [entries]);

  const visibleEntries = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    if (!keyword) return orderedEntries;
    return orderedEntries.filter((entry) => {
      return (
        entry.name.toLowerCase().includes(keyword) ||
        entry.id.toLowerCase().includes(keyword)
      );
    });
  }, [orderedEntries, query]);

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

  const openDetail = (entry: IndexV2Entry) => {
    navigate(`/manage-resources/detail?id=${encodeURIComponent(entry.id)}`, {
      state: { entry },
    });
  };

  return (
    <Page>
      <div className="flex flex-col gap-4 px-3 pb-8 pt-3 sm:px-5">
        <PageHeader
          title="资源管理"
          icon={<PackageIcon size={25} className="text-purple-300" />}
        />

        <div className="mx-auto flex w-full max-w-6xl flex-col gap-3">
          <p className="text-sm text-white/60">
            {env.owner}/{env.repoName}
          </p>
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
            <div className="flex flex-col gap-2.5">
              {visibleEntries.map((entry, index) => (
                <ResourceCard
                  key={`${entry.id}-${index}`}
                  entry={entry}
                  onOpen={() => openDetail(entry)}
                />
              ))}
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

function ResourceCard({
  entry,
  onOpen,
}: {
  entry: IndexV2Entry;
  onOpen: () => void;
}) {
  const repoUrl = indexItemRepoUrl(entry);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen();
        }
      }}
      className="flex cursor-pointer items-start gap-3 rounded-xl border border-white/10 bg-nav-item px-3 py-3 transition-colors outline-none hover:bg-nav-item-hover focus-visible:ring-2 focus-visible:ring-purple-400/60"
    >
      <ResourceIcon
        rawUrl={indexItemIconUrl(entry)}
        className="size-10 rounded-full border border-white/10"
      />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <p className="min-w-0 break-words text-sm font-semibold text-white">
            {entry.name}
          </p>
          <ResourceBadges entry={entry} />
        </div>
        <p className="mt-1 truncate font-mono text-xs text-white/45">
          {entry.id}
        </p>
        {entry.tags.filter(Boolean).length > 0 && (
          <p className="mt-1 truncate text-xs text-white/40">
            标签：{entry.tags.filter(Boolean).join(" · ")}
          </p>
        )}
      </div>
      <a
        href={repoUrl}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="打开仓库"
        title="打开仓库"
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          openExternal(repoUrl);
        }}
        className="mt-1 shrink-0 text-white/35 transition-colors hover:text-white/70"
      >
        <GithubLogoIcon size={16} weight="duotone" />
      </a>
    </div>
  );
}
