import { Select, Spinner } from "~/components/ScaleAwareThemes";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ExternalAuthorizationPanel } from "~/components/resource/ExternalAuthorizationPanel";
import { loadOwnedCatalogResourcesForCurrentUser } from "~/logic/publish/resources";
import { SectionCard } from "~/routes/resource/publish/components/shared";

export function ExternalAuthorizationManager() {
  const [resourceId, setResourceId] = useState("");
  const [deviceId, setDeviceId] = useState("");

  const {
    data: ownedResources = [],
    isLoading: resourcesLoading,
  } = useQuery({
    queryKey: ["ownedCatalogResources"],
    queryFn: loadOwnedCatalogResourcesForCurrentUser,
  });

  const deviceOptions = useMemo(() => {
    const resource = ownedResources.find((item) => item.entry.id === resourceId);
    if (!resource) return [] as string[];
    return resource.entry.devices
      .split(";")
      .map((item) => item.trim())
      .filter(Boolean);
  }, [ownedResources, resourceId]);

  useEffect(() => {
    setDeviceId((prev) =>
      deviceOptions.includes(prev) ? prev : deviceOptions[0] ?? "",
    );
  }, [deviceOptions]);

  return (
    <SectionCard
      title="自有网站授权"
      description="在你自己的网站售卖并核单，由你的服务器签名授权后才允许用户解密安装"
    >
      <div className="flex flex-col gap-4">
        {resourcesLoading && (
          <div className="flex items-center gap-2 px-1 py-4 text-white/60">
            <Spinner size="2" />
            <span className="text-sm">正在加载资源列表...</span>
          </div>
        )}

        {!resourcesLoading && ownedResources.length === 0 && (
          <div className="rounded-lg border border-dashed border-white/10 bg-black/20 px-4 py-6 text-center text-sm text-white/60">
            没有可管理的已发布资源。未上架的资源可在发布页的加密配置中设置。
          </div>
        )}

        {!resourcesLoading && ownedResources.length > 0 && (
          <div className="grid gap-3 rounded-xl border border-white/10 bg-black/20 p-3.5 md:grid-cols-2">
            <label className="flex flex-col gap-1.5">
              <span className="text-xs text-white/55">资源</span>
              <Select.Root value={resourceId} onValueChange={setResourceId}>
                <Select.Trigger placeholder="选择资源" className="w-full" />
                <Select.Content position="popper">
                  {ownedResources.map((item) => (
                    <Select.Item key={item.entry.id} value={item.entry.id}>
                      {item.entry.name || item.entry.id}
                    </Select.Item>
                  ))}
                </Select.Content>
              </Select.Root>
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-xs text-white/55">设备</span>
              <Select.Root
                value={deviceId}
                onValueChange={setDeviceId}
                disabled={deviceOptions.length === 0}
              >
                <Select.Trigger placeholder="选择设备" className="w-full" />
                <Select.Content position="popper">
                  {deviceOptions.map((device) => (
                    <Select.Item key={device} value={device}>
                      {device}
                    </Select.Item>
                  ))}
                </Select.Content>
              </Select.Root>
            </label>
          </div>
        )}

        {resourceId && deviceId && (
          <ExternalAuthorizationPanel resourceId={resourceId} deviceId={deviceId} />
        )}
      </div>
    </SectionCard>
  );
}
