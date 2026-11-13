import { useEffect, useMemo, useRef, useState } from "react";
import { PlugsConnectedIcon, WarningIcon } from "@phosphor-icons/react";
import { SegmentedControl, Select, Switch, TextArea, TextField } from "~/components/ScaleAwareThemes";
import {
  fetchNgPluginIndex,
  ngPluginDisplayName,
  type NgPluginIndexEntry,
} from "~/logic/publish/plugin-repo";
import {
  PLUGIN_INSTALL_DATA_MAX_BYTES,
  PLUGIN_INSTALL_FALLBACK_LABELS,
  PLUGIN_INSTALL_MIN_API_LEVEL,
  PLUGIN_INSTALL_NAME_MAX_CHARS,
  checkPluginInstallMarket,
  describePluginInstallMarketIssue,
  inspectPluginInstall,
  parsePluginInstallData,
  readPluginInstall,
  writePluginInstall,
  type PluginInstallFallback,
} from "~/logic/publish/plugin-install";
import { FieldHelpButton, FieldHelpDialog, SectionCard, type FieldHelpItem } from "./shared";

interface PluginInstallSectionProps {
  /** 表单里自定义 ext 的 JSON 文本，设置读写在其中的 `pluginInstall` 键。 */
  extRaw: string;
  onChange: (extRaw: string) => void;
}

const HELP: FieldHelpItem[] = [
  {
    group: "插件接管安装",
    label: "它做什么",
    icon: <PlugsConnectedIcon size={16} weight="duotone" />,
    description:
      "用户点资源页的下载/安装按钮时，AstroBox 不再走常规下载，而是调用你指定的插件（需是支持 Level 4 的插件，并实现了资源安装处理），把资源信息、用户选中的设备和你填的数据交给它。插件可以自己把安装任务加入队列、直接向设备传输数据，或带用户去插件页完成核销（兑换码、卡密、授权等）。",
  },
  {
    group: "插件接管安装",
    label: "插件名",
    icon: <PlugsConnectedIcon size={16} weight="duotone" />,
    description:
      "从插件市场里选择插件，或手填它的名称（与插件 manifest 的 name 一致）。只有 API Level 4 以上的插件才能实现资源安装处理。用户没装这个插件时，会被询问是否一键安装，所以插件需要已经上架插件市场。",
  },
  {
    group: "插件接管安装",
    label: "插件不可用时",
    icon: <WarningIcon size={16} weight="duotone" />,
    description:
      "插件被停用、没运行起来或用户的客户端过旧时：「提示用户并停下」不会下载任何东西；「退回常规下载」会照常下载你上传的包体，适合插件只是锦上添花的资源。",
  },
  {
    group: "插件接管安装",
    label: "交给插件的数据",
    icon: <WarningIcon size={16} weight="duotone" />,
    description:
      "任意 JSON，原样交给插件，最多 16 KiB。资源 manifest 是公开的，任何人都看得到，不要把密钥、私有令牌写进去。",
  },
];

/**
 * 让某个插件接管资源的下载/安装按钮：插件名、不可用时的行为、以及交给插件的自定义数据。
 */
export function PluginInstallSection({ extRaw, onChange }: PluginInstallSectionProps) {
  const [helpOpen, setHelpOpen] = useState(false);
  const value = useMemo(() => readPluginInstall(extRaw), [extRaw]);
  const inspection = useMemo(() => {
    let ext: unknown = null;
    try {
      ext = JSON.parse(extRaw.trim() || "{}");
    } catch {
      ext = null;
    }
    return inspectPluginInstall(ext);
  }, [extRaw]);

  // data 的编辑草稿：输入到一半不是合法 JSON 时不能写进 ext，但要让作者继续改。
  // 外部改动 ext（载入草稿、手改 JSON）时才用 ext 里的内容重置草稿，自己写出去的不重置，免得光标跳走。
  const [dataDraft, setDataDraft] = useState(value?.dataText ?? "");
  const lastWritten = useRef(extRaw);
  useEffect(() => {
    if (extRaw === lastWritten.current) return;
    lastWritten.current = extRaw;
    setDataDraft(readPluginInstall(extRaw)?.dataText ?? "");
  }, [extRaw]);

  const dataState = useMemo(() => parsePluginInstallData(dataDraft), [dataDraft]);
  const dataBytes = useMemo(() => {
    if (!dataState.ok || dataState.empty) return 0;
    try {
      return new TextEncoder().encode(JSON.stringify(dataState.value) ?? "").length;
    } catch {
      return 0;
    }
  }, [dataState]);

  const enabled = value !== null;

  // 插件市场索引：用来挑选插件，并核对填的名字真的在市场里、且是 Level 4。
  const [plugins, setPlugins] = useState<NgPluginIndexEntry[] | null>(null);
  const [pluginsLoading, setPluginsLoading] = useState(false);
  const [pluginsError, setPluginsError] = useState("");
  useEffect(() => {
    if (!enabled || plugins || pluginsLoading) return;
    let cancelled = false;
    setPluginsLoading(true);
    setPluginsError("");
    fetchNgPluginIndex()
      .then((entries) => {
        if (!cancelled) setPlugins(entries);
      })
      .catch((error) => {
        if (!cancelled) setPluginsError(error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        if (!cancelled) setPluginsLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);
  const pluginOptions = useMemo(
    () =>
      (plugins ?? [])
        .map((entry) => ({ name: ngPluginDisplayName(entry), apiLevel: entry.manifest?.api_level ?? 0 }))
        .filter((entry) => entry.name)
        .sort((a, b) => a.name.localeCompare(b.name)),
    [plugins],
  );
  const marketIssue = useMemo(() => {
    if (!value?.plugin.trim() || inspection.problems.some((message) => message.includes("插件名"))) return null;
    return describePluginInstallMarketIssue(
      value.plugin.trim(),
      checkPluginInstallMarket(value.plugin, plugins),
    );
  }, [inspection.problems, plugins, value?.plugin]);

  const write = (next: string) => {
    lastWritten.current = next;
    onChange(next);
  };

  const toggle = (checked: boolean) => {
    if (!checked) {
      setDataDraft("");
      write(writePluginInstall(extRaw, null));
      return;
    }
    setDataDraft("");
    write(writePluginInstall(extRaw, { plugin: "", fallback: "block", dataText: "" }));
  };

  const patch = (partial: Partial<{ plugin: string; fallback: PluginInstallFallback; dataText: string }>) => {
    if (!value) return;
    write(writePluginInstall(extRaw, { ...value, dataText: dataDraft, ...partial }));
  };

  return (
    <SectionCard
      title="插件接管安装"
      description="让一个插件接管本资源的下载/安装按钮：由插件完成核销、传输或入队安装。"
      headerExtra={<FieldHelpButton onClick={() => setHelpOpen(true)} title="插件接管安装说明" />}
    >
      <div data-publish-field="pluginInstall" className="flex flex-col gap-3">
        <div className="rounded-lg border border-white/10 bg-black/20 px-3 py-3">
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 flex-col gap-1">
              <p className="text-sm font-medium text-white">由插件接管下载/安装</p>
            </div>
            <Switch checked={enabled} onCheckedChange={toggle} />
          </div>

          {value ? (
            <div className="mt-3 flex flex-col gap-3 border-t border-white/10 pt-3">
              <div className="flex flex-col gap-1.5">
                <p className="text-xs text-white/60">插件名</p>
                <TextField.Root
                  value={value.plugin}
                  radius="large"
                  placeholder="插件市场里的插件名称"
                  maxLength={PLUGIN_INSTALL_NAME_MAX_CHARS}
                  spellCheck={false}
                  autoComplete="off"
                  color={inspection.problems.some((message) => message.includes("插件名")) ? "red" : undefined}
                  onChange={(event) => patch({ plugin: event.target.value })}
                />
                {pluginOptions.length > 0 ? (
                  <Select.Root
                    value={pluginOptions.some((entry) => entry.name === value.plugin) ? value.plugin : undefined}
                    onValueChange={(plugin) => patch({ plugin })}
                  >
                    <Select.Trigger placeholder="从插件市场选择" radius="large" />
                    <Select.Content position="popper">
                      {pluginOptions.map((entry) => (
                        <Select.Item
                          key={entry.name}
                          value={entry.name}
                          disabled={entry.apiLevel < PLUGIN_INSTALL_MIN_API_LEVEL}
                        >
                          {entry.name}
                          {entry.apiLevel < PLUGIN_INSTALL_MIN_API_LEVEL
                            ? `（Level ${entry.apiLevel}，不支持）`
                            : ""}
                        </Select.Item>
                      ))}
                    </Select.Content>
                  </Select.Root>
                ) : pluginsLoading ? (
                  <p className="text-xs text-white/50">正在加载插件市场…</p>
                ) : pluginsError ? (
                  <p className="text-xs text-amber-300">无法加载插件市场：{pluginsError}</p>
                ) : null}
                {marketIssue ? <p className="text-xs text-amber-300">{marketIssue}</p> : null}
              </div>

              <div className="flex flex-col gap-1.5">
                <p className="text-xs text-white/60">插件不可用时</p>
                <SegmentedControl.Root
                  value={value.fallback}
                  onValueChange={(fallback) => patch({ fallback: fallback as PluginInstallFallback })}
                  size="1"
                >
                  <SegmentedControl.Item value="block">{PLUGIN_INSTALL_FALLBACK_LABELS.block}</SegmentedControl.Item>
                  <SegmentedControl.Item value="download">{PLUGIN_INSTALL_FALLBACK_LABELS.download}</SegmentedControl.Item>
                </SegmentedControl.Root>
              </div>

              <div className="flex flex-col gap-1.5">
                <p className="text-xs text-white/60">
                  交给插件的数据（JSON，选填）
                  <span className={`ml-2 ${dataBytes > PLUGIN_INSTALL_DATA_MAX_BYTES ? "text-red-400" : "text-white/40"}`}>
                    {dataBytes}/{PLUGIN_INSTALL_DATA_MAX_BYTES} 字节
                  </span>
                </p>
                <TextArea
                  rows={5}
                  radius="large"
                  spellCheck={false}
                  placeholder='例如 {"sku": "abc"}'
                  className="font-mono"
                  color={dataState.ok ? undefined : "red"}
                  value={dataDraft}
                  onChange={(event) => {
                    const text = event.target.value;
                    setDataDraft(text);
                    if (parsePluginInstallData(text).ok) patch({ dataText: text });
                  }}
                />
                {!dataState.ok ? (
                  <p className="px-1 text-xs text-red-400">不是合法的 JSON：{dataState.error}</p>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>

        {inspection.problems.map((message) => (
          <p key={message} className="px-1 text-xs text-red-400">
            {message}
          </p>
        ))}
      </div>

      <FieldHelpDialog open={helpOpen} onOpenChange={setHelpOpen} title="插件接管安装说明" items={HELP} />
    </SectionCard>
  );
}
