import { pluginRepoLabel } from "~/logic/publish/plugin-index";
import type { PluginIndexEntryGroup } from "~/logic/publish/plugin-review";

export function pluginGroupLabel(
  group: PluginIndexEntryGroup,
  index: number,
): string {
  const names = group.plugins
    .map((plugin) => plugin.manifest?.name?.trim() || plugin.rawName?.trim())
    .filter((name): name is string => Boolean(name));
  if (names.length > 0) {
    return names.length > 1 ? `${names[0]} +${names.length - 1}` : names[0];
  }
  if (group.parsed) return pluginRepoLabel(group.parsed);
  return `条目 ${index + 1}`;
}

interface PluginEntryTabBarProps {
  groups: PluginIndexEntryGroup[];
  activeIndex: number;
  onChange: (index: number) => void;
}

/** 与资源审核的多资源切换条保持一致：单条时不渲染。 */
export function PluginEntryTabBar({
  groups,
  activeIndex,
  onChange,
}: PluginEntryTabBarProps) {
  if (groups.length <= 1) return null;
  const safeActive = Math.min(activeIndex, Math.max(0, groups.length - 1));
  return (
    <div className="flex flex-wrap gap-1">
      {groups.map((group, index) => (
        <button
          type="button"
          key={group.key}
          aria-current={index === safeActive ? "true" : undefined}
          onClick={() => onChange(index)}
          className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm transition ${
            index === safeActive
              ? "bg-white/15 text-white"
              : "bg-white/[0.04] text-white/55 hover:bg-white/10 hover:text-white/80"
          }`}
        >
          {pluginGroupLabel(group, index)}
        </button>
      ))}
    </div>
  );
}
