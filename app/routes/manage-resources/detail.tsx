import {
  CaretLeft,
  GithubLogoIcon,
  MagnifyingGlassIcon,
  PackageIcon,
  XIcon,
} from "@phosphor-icons/react";
import { Callout } from "@radix-ui/themes";
import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router";
import { inputClass } from "~/components/admin/AdminPage";
import NavIconButton from "~/components/nav-icon-button";
import Page from "~/layout/page";
import {
  adminUserDisplayName,
  getAdminUserEntry,
  requestAdminUser,
  useAdminUserDirectoryVersion,
} from "~/logic/account/admin-user-directory";
import { useManageResourceAccess } from "~/logic/account/manage-resource-access";
import {
  indexItemAssetUrl,
  indexItemIconUrl,
  parseIndexV2,
  type IndexV2Entry,
} from "~/logic/catalog/index-v2";
import {
  collectResourceAdminUserIds,
  loadResourceAdminInfo,
  type ResourceAdminInfo,
  type ResourceAdminInfoSection,
} from "~/logic/catalog/resource-admin-info";
import type { DetailSearchContext } from "~/logic/catalog/detail-search";
import { loadResourceManifest } from "~/logic/catalog/resource-manifest";
import {
  loadDeviceNameMap,
  loadDeviceTokenResolver,
  type DeviceTokenResolver,
} from "~/logic/devices/catalog";
import { fetchCatalogEntries } from "~/logic/publish/catalog";
import type { ManifestV2 } from "~/logic/publish/manifest-loader";
import { LoadingIndicator } from "~/routes/resreview/components/LoadingIndicator";
import { ReviewAccessMessage } from "~/routes/resreview/components/ReviewAccessMessage";
import {
  CommercePanel,
  EntitlementsPanel,
  ManifestPanel,
  OrdersPanel,
  ProxiedImage,
  ReportsPanel,
  ResourceInfoPanel,
} from "./components/ResourceDetailSections";
import {
  openExternal,
  ResourceBadges,
  ResourceIcon,
} from "./components/ResourceVisuals";

interface DetailLocationState {
  entry?: IndexV2Entry;
}

export default function ManageResourceDetailPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const access = useManageResourceAccess();
  const resourceId = searchParams.get("id")?.trim() ?? "";
  // 需要 AstroBox 后台角色的分区（售卖配置 / 权益 / 订单 / 举报）单独判定：
  // 没有权限时页面照常进入，这几个分区就地显示「需要 admin 权限」。
  const canReadAdmin = access.astroboxLoggedIn && access.isAstroboxAdmin;
  const initialEntry =
    (location.state as DetailLocationState | null)?.entry ?? null;

  const [entry, setEntry] = useState<IndexV2Entry | null>(initialEntry);
  const [entryLoading, setEntryLoading] = useState(!initialEntry);
  const [entryError, setEntryError] = useState("");

  const [manifest, setManifest] = useState<ManifestV2 | null>(null);
  const [manifestLoading, setManifestLoading] = useState(false);
  const [manifestError, setManifestError] = useState("");

  const [adminInfo, setAdminInfo] = useState<ResourceAdminInfo | null>(null);
  const [adminLoading, setAdminLoading] = useState(false);
  const [adminErrors, setAdminErrors] = useState<
    Partial<Record<ResourceAdminInfoSection, string>>
  >({});

  // 详情页关键字过滤：面板里的列表行都会被它筛一遍。
  const [keyword, setKeyword] = useState("");
  // 设备名映射：把裸设备 id / 机型号显示成「设备名（id）」。
  const [deviceNames, setDeviceNames] = useState<Map<string, string> | null>(null);
  const [deviceResolver, setDeviceResolver] = useState<DeviceTokenResolver | null>(
    null,
  );

  // 0. 设备表是纯静态资源，进页面就顺手取回来。
  useEffect(() => {
    let alive = true;
    Promise.all([loadDeviceNameMap(), loadDeviceTokenResolver()])
      .then(([names, resolver]) => {
        if (!alive) return;
        setDeviceNames(names);
        setDeviceResolver(() => resolver);
      })
      .catch(() => {
        // 取不到设备表就退回展示原始 id，不影响别的分区。
      });
    return () => {
      alive = false;
    };
  }, []);

  // 1. 解析目录条目：优先用列表页带过来的 state，直链则回读 index_v2.csv。
  useEffect(() => {
    if (!access.repoAllowed) return;
    if (initialEntry && initialEntry.id === resourceId) {
      setEntry(initialEntry);
      setEntryLoading(false);
      setEntryError("");
      return;
    }
    if (!resourceId) {
      setEntryLoading(false);
      setEntryError("缺少资源 ID");
      return;
    }
    let alive = true;
    setEntryLoading(true);
    setEntryError("");
    fetchCatalogEntries()
      .then((result) => {
        if (!alive) return;
        const found = parseIndexV2(result.csvContent).find(
          (item) => item.id === resourceId,
        );
        if (!found) {
          setEntryError(`目录中找不到 ID 为 ${resourceId} 的资源`);
          return;
        }
        setEntry(found);
      })
      .catch((err) => {
        if (!alive) return;
        setEntryError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (alive) setEntryLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [access.repoAllowed, initialEntry, resourceId]);

  // 2. 读取资源仓库的 manifest_v2.json。
  useEffect(() => {
    if (!access.repoAllowed || !entry) return;
    let alive = true;
    setManifest(null);
    setManifestError("");
    setManifestLoading(true);
    loadResourceManifest(entry)
      .then((result) => {
        if (alive) setManifest(result.manifest);
      })
      .catch((err) => {
        if (!alive) return;
        setManifestError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (alive) setManifestLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [access.repoAllowed, entry]);

  // 3. 汇总 AstroBox 后台数据（售卖配置 / 权益 / 订单 / 举报）。
  useEffect(() => {
    if (!access.repoAllowed || !canReadAdmin || !entry) return;
    let alive = true;
    setAdminInfo(null);
    setAdminErrors({});
    setAdminLoading(true);
    loadResourceAdminInfo(entry.id)
      .then((result) => {
        if (!alive) return;
        setAdminInfo(result.data);
        setAdminErrors(result.errors);
      })
      .catch((err) => {
        if (!alive) return;
        setAdminErrors({
          configs: err instanceof Error ? err.message : String(err),
        });
      })
      .finally(() => {
        if (alive) setAdminLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [access.repoAllowed, canReadAdmin, entry]);

  // 4. 账号目录预取：详情页上出现的 uid 先批量解析（限并发 + 去重），
  //    这样「按昵称搜索」在过滤之前就能拿到名字，不会出现搜不到界面上看得见的人。
  const directoryVersion = useAdminUserDirectoryVersion();
  useEffect(() => {
    if (!canReadAdmin) return;
    for (const userId of collectResourceAdminUserIds(adminInfo)) {
      requestAdminUser(userId);
    }
  }, [canReadAdmin, adminInfo]);

  const panelContext = useMemo<DetailSearchContext>(
    () => ({
      keyword,
      userName: (userId) => adminUserDisplayName(getAdminUserEntry(userId), ""),
      deviceLabel: (deviceId) => {
        const raw = (deviceId ?? "").trim();
        if (!raw) return "";
        const canonical = deviceResolver?.(raw) ?? raw;
        const name = deviceNames?.get(canonical);
        return name ? `${name}（${canonical}）` : raw;
      },
    }),
    // directoryVersion：账号名解析完成后重建闭包，让过滤结果跟着刷新。
    [keyword, directoryVersion, deviceResolver, deviceNames],
  );

  const goBack = () => navigate("/manage-resources");

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

  if (!access.repoAllowed) {
    return (
      <ReviewAccessMessage
        title="资源管理"
        text={`当前 GitHub 账号没有 ${access.repoLabel} 的仓库管理权限。${access.repoError ? ` ${access.repoError}` : ""}`}
      />
    );
  }

  if (entryLoading) {
    return (
      <div className="grid h-full w-full place-items-center px-6">
        <LoadingIndicator
          text="正在载入资源详情"
          hint="正在读取社区仓库的 index_v2.csv"
        />
      </div>
    );
  }

  if (!entry) {
    return (
      <Page>
        <div className="flex flex-col gap-4 px-3 pb-8 pt-3 sm:px-5">
          <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
            <div className="flex items-center gap-3">
              <BackButton onClick={goBack} />
              <h2 className="truncate text-xl font-semibold text-white">
                资源详情
              </h2>
            </div>
            <Callout.Root color="red" variant="soft">
              <Callout.Icon>
                <PackageIcon size={16} weight="fill" />
              </Callout.Icon>
              <Callout.Text className="font-semibold">
                {entryError || "找不到该资源"}
              </Callout.Text>
            </Callout.Root>
          </div>
        </div>
      </Page>
    );
  }

  const repoUrl = `https://github.com/${entry.repo_owner}/${entry.repo_name}`;
  const coverPath = manifest?.item.cover?.trim() || entry.cover;
  const coverUrl = indexItemAssetUrl(entry, coverPath);

  return (
    <Page>
      <div className="flex flex-col gap-4 px-3 pb-8 pt-3 sm:px-5">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
          <div className="flex items-start gap-3">
            <BackButton onClick={goBack} />
            <ResourceIcon
              rawUrl={indexItemIconUrl(entry)}
              className="size-12 rounded-full border border-white/10"
            />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="min-w-0 break-words text-xl font-semibold text-white">
                  {entry.name}
                </h2>
                <ResourceBadges entry={entry} size="2" />
              </div>
              <p className="truncate font-mono-sarasa text-xs text-white/50">
                {entry.id}
              </p>
            </div>
            <NavIconButton
              onClick={() => openExternal(repoUrl)}
              aria-label="打开仓库"
              title="打开仓库"
              className="size-10! shrink-0"
            >
              <GithubLogoIcon size={18} weight="duotone" />
            </NavIconButton>
          </div>

          {coverUrl && (
            <section className="rounded-2xl border border-white/10 bg-nav-item p-4">
              <p className="mb-2 text-xs text-white/45">封面</p>
              <button
                type="button"
                title="在外部打开封面"
                className="block w-full overflow-hidden rounded-lg border border-white/10 bg-black/20 transition-colors hover:border-white/25"
                onClick={() => openExternal(coverUrl)}
              >
                <ProxiedImage
                  url={coverUrl}
                  alt={entry.name}
                  className="max-h-[40vh] w-full object-contain"
                />
              </button>
            </section>
          )}

          <ResourceInfoPanel entry={entry} />

          <section className="rounded-2xl border border-white/10 bg-nav-item p-3">
            <div className="flex items-center gap-2">
              <MagnifyingGlassIcon size={16} className="shrink-0 text-white/40" />
              <input
                className={inputClass}
                value={keyword}
                onChange={(event) => setKeyword(event.target.value)}
                placeholder="搜索这个资源的内容（账号 / 设备 / 状态 / 单号 / 文件名…）"
                aria-label="搜索资源详情"
              />
              {keyword && (
                <NavIconButton
                  onClick={() => setKeyword("")}
                  aria-label="清空搜索"
                  title="清空搜索"
                  className="size-9! shrink-0"
                >
                  <XIcon size={16} />
                </NavIconButton>
              )}
            </div>
          </section>

          <ManifestPanel
            entry={entry}
            manifest={manifest}
            loading={manifestLoading}
            error={manifestError}
            context={panelContext}
          />

          <CommercePanel
            configs={adminInfo?.configs ?? null}
            loading={adminLoading}
            error={adminErrors.configs}
            permissionDenied={!canReadAdmin}
            context={panelContext}
          />
          <EntitlementsPanel
            items={adminInfo?.entitlements ?? []}
            loading={adminLoading}
            error={adminErrors.entitlements}
            permissionDenied={!canReadAdmin}
            context={panelContext}
          />
          <OrdersPanel
            items={adminInfo?.orders ?? []}
            loading={adminLoading}
            error={adminErrors.orders}
            permissionDenied={!canReadAdmin}
            context={panelContext}
          />
          <ReportsPanel
            items={adminInfo?.reports ?? []}
            loading={adminLoading}
            error={adminErrors.reports}
            permissionDenied={!canReadAdmin}
            context={panelContext}
          />
        </div>
      </div>
    </Page>
  );
}

function BackButton({ onClick }: { onClick: () => void }) {
  return (
    <NavIconButton
      onClick={onClick}
      aria-label="返回资源列表"
      title="返回资源列表"
      className="size-10! shrink-0 bg-white/10 hover:bg-white/20"
    >
      <CaretLeft weight="bold" size={20} />
    </NavIconButton>
  );
}
