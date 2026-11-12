import { useMemo, useState } from "react";
import { WarningIcon } from "@phosphor-icons/react";
import { SegmentedControl, Select, Switch, TextArea } from "~/components/ScaleAwareThemes";
import {
  FORCE_UPDATE_REASON_MAX,
  collectDownloadVersions,
  inspectForceUpdate,
  readForceUpdate,
  writeForceUpdate,
  type ForceUpdateStrategy,
} from "~/logic/publish/force-update";
import { FieldHelpButton, FieldHelpDialog, SectionCard, type FieldHelpItem } from "./shared";

interface ForceUpdateSectionProps {
  /** 表单里自定义 ext 的 JSON 文本，强制更新设置读写在其中的 `forceUpdate` 键。 */
  extRaw: string;
  /** 本次发布的各下载行（正式包体），版本号从这里选。 */
  downloads: ReadonlyArray<{ version?: string }>;
  onChange: (extRaw: string) => void;
}

const HELP: FieldHelpItem[] = [
  {
    group: "强制更新",
    label: "什么时候生效",
    icon: <WarningIcon size={16} weight="duotone" />,
    description:
      "用户已经安装过本资源、设备连接后检查到的更新恰好是你绑定的那个版本时才生效。声明绑定在版本上：之后发布了新版本，旧声明不会跟到新版本上，需要的话请为新版本重新开启。",
  },
  {
    group: "强制更新",
    label: "弹窗提示（可忽略）",
    icon: <WarningIcon size={16} weight="duotone" />,
    description:
      "专门为本资源弹一个窗：「该资源的创作者强烈建议您进行更新，理由如下：…」，理由可选填。用户可以忽略，也可以点按钮直接加入队列下载并安装。",
  },
  {
    group: "强制更新",
    label: "静默更新（不提醒）",
    icon: <WarningIcon size={16} weight="duotone" />,
    description:
      "不提醒用户，检查到更新后直接加入队列下载并安装。仅用于修复严重问题，请慎用：用户事先并不知情。若本资源有「必需」捆绑项且用户没有装齐，会自动退回弹窗提示；静默更新失败后也会退回普通的更新提示，同一设备同一版本只会尝试一次。",
  },
];

export function ForceUpdateSection({ extRaw, downloads, onChange }: ForceUpdateSectionProps) {
  const [helpOpen, setHelpOpen] = useState(false);
  const value = useMemo(() => readForceUpdate(extRaw), [extRaw]);
  const versions = useMemo(() => collectDownloadVersions(downloads), [downloads]);
  const inspection = useMemo(() => {
    let ext: unknown = null;
    try {
      ext = JSON.parse(extRaw.trim() || "{}");
    } catch {
      ext = null;
    }
    return inspectForceUpdate(ext, downloads);
  }, [extRaw, downloads]);

  const enabled = value !== null;
  // 当前绑定的版本不在下载项里时仍要能显示出来，让作者看见并改掉
  const versionOptions = useMemo(
    () => (value?.version && !versions.includes(value.version) ? [value.version, ...versions] : versions),
    [value?.version, versions],
  );

  const toggle = (next: boolean) => {
    if (!next) {
      onChange(writeForceUpdate(extRaw, null));
      return;
    }
    onChange(
      writeForceUpdate(extRaw, {
        version: versions[0] ?? "",
        strategy: "prompt",
        reason: "",
      }),
    );
  };

  const patch = (partial: Partial<{ version: string; strategy: ForceUpdateStrategy; reason: string }>) => {
    if (!value) return;
    onChange(writeForceUpdate(extRaw, { ...value, ...partial }));
  };

  return (
    <SectionCard
      title="资源强制更新"
      description="某个版本修复了严重问题时，可以让已安装的用户在连接设备后被提醒、甚至被静默更新到这个版本。"
      headerExtra={<FieldHelpButton onClick={() => setHelpOpen(true)} title="强制更新说明" />}
    >
      <div data-publish-field="forceUpdate" className="flex flex-col gap-3">
        <div className="rounded-lg border border-white/10 bg-black/20 px-3 py-3">
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 flex-col gap-1">
              <p className="text-sm font-medium text-white">将某个版本标为强制更新</p>
              <p className="text-xs text-white/60">
                仅对已安装本资源的用户生效，设备连接后检查到该版本的更新时按下面的策略处理。
              </p>
            </div>
            <Switch checked={enabled} onCheckedChange={toggle} />
          </div>

          {value ? (
            <div className="mt-3 flex flex-col gap-3 border-t border-white/10 pt-3">
              <div className="flex flex-col gap-1.5">
                <p className="text-xs text-white/60">强制更新的版本</p>
                {versionOptions.length > 0 ? (
                  <Select.Root
                    value={value.version || undefined}
                    onValueChange={(version) => patch({ version })}
                  >
                    <Select.Trigger placeholder="选择下载项里的版本号" radius="large" />
                    <Select.Content position="popper">
                      {versionOptions.map((version) => (
                        <Select.Item key={version} value={version}>
                          {version}
                          {versions.includes(version) ? "" : "（下载项里没有这个版本）"}
                        </Select.Item>
                      ))}
                    </Select.Content>
                  </Select.Root>
                ) : (
                  <p className="text-xs text-amber-300">请先在上面的下载项里填写版本号，再选择要强制更新的版本。</p>
                )}
              </div>

              <div className="flex flex-col gap-1.5">
                <p className="text-xs text-white/60">更新策略</p>
                <SegmentedControl.Root
                  value={value.strategy}
                  onValueChange={(strategy) => patch({ strategy: strategy as ForceUpdateStrategy })}
                  size="1"
                >
                  <SegmentedControl.Item value="prompt">弹窗提示（可忽略）</SegmentedControl.Item>
                  <SegmentedControl.Item value="silent">静默更新（不提醒）</SegmentedControl.Item>
                </SegmentedControl.Root>
              </div>

              {value.strategy === "prompt" ? (
                <div className="flex flex-col gap-1.5">
                  <p className="text-xs text-white/60">
                    更新理由（选填，会显示在弹窗里）
                    <span className="ml-2 text-white/40">
                      {Array.from(value.reason).length}/{FORCE_UPDATE_REASON_MAX}
                    </span>
                  </p>
                  <TextArea
                    rows={3}
                    radius="large"
                    placeholder="例如：修复了在部分设备上启动即闪退的问题"
                    value={value.reason}
                    onChange={(event) =>
                      patch({ reason: Array.from(event.target.value).slice(0, FORCE_UPDATE_REASON_MAX).join("") })
                    }
                  />
                </div>
              ) : (
                <p className="flex items-start gap-1.5 rounded-lg border border-amber-400/30 bg-amber-500/10 px-2.5 py-2 text-xs text-amber-200">
                  <WarningIcon size={14} weight="fill" className="mt-px shrink-0" />
                  <span>
                    静默更新不会通知用户，直接安装到用户设备上。请只用于修复严重问题，并确保这个版本已经充分测试。
                  </span>
                </p>
              )}
            </div>
          ) : null}
        </div>

        {inspection.problems.map((message) => (
          <p key={message} className="px-1 text-xs text-red-400">
            {message}
          </p>
        ))}
        {inspection.warnings.map((message) => (
          <p key={message} className="px-1 text-xs text-amber-300">
            {message}
            。若这是为旧版本留下的声明，请关闭开关或重新选择版本。
          </p>
        ))}
      </div>

      <FieldHelpDialog open={helpOpen} onOpenChange={setHelpOpen} title="强制更新说明" items={HELP} />
    </SectionCard>
  );
}
