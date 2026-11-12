import { useMemo } from "react";
import { TextField } from "~/components/ScaleAwareThemes";
import {
  CANOPUS_MODULE_RESTYPE,
  inspectCanopusManager,
  readCanopusManagerMinVersion,
  writeCanopusManagerMinVersion,
} from "~/logic/publish/canopus-manager";
import { SectionCard } from "./shared";

interface CanopusManagerSectionProps {
  /** 表单里自定义 ext 的 JSON 文本，最低管理器版本读写在其中的 `canopusManager.minVersion`。 */
  extRaw: string;
  onChange: (extRaw: string) => void;
}

/**
 * 「模块」类资源要求的最低 Canopus 管理器版本。
 * 设备上的管理器低于它时，客户端会要求先更新管理器再安装模块；留空表示不限制。
 */
export function CanopusManagerSection({ extRaw, onChange }: CanopusManagerSectionProps) {
  const value = useMemo(() => readCanopusManagerMinVersion(extRaw), [extRaw]);
  const problems = useMemo(() => {
    let ext: unknown = null;
    try {
      ext = JSON.parse(extRaw.trim() || "{}");
    } catch {
      ext = null;
    }
    return inspectCanopusManager(ext, CANOPUS_MODULE_RESTYPE).problems;
  }, [extRaw]);

  return (
    <SectionCard
      title="Canopus 管理器要求"
      description="模块依赖 Canopus 管理器。填写后，设备上的管理器低于该版本时会先要求更新管理器；留空表示不限制。"
    >
      <div data-publish-field="canopusManager" className="flex flex-col gap-2">
        <div className="rounded-lg border border-white/10 bg-black/20 px-3 py-3">
          <p className="pb-1.5 text-sm font-medium text-white">最低管理器版本</p>
          <TextField.Root
            value={value}
            radius="large"
            placeholder="例如 2.0.3（不限制则留空）"
            inputMode="decimal"
            spellCheck={false}
            autoComplete="off"
            color={problems.length > 0 ? "red" : undefined}
            onChange={(event) => onChange(writeCanopusManagerMinVersion(extRaw, event.target.value))}
          />
        </div>
        {problems.map((message) => (
          <p key={message} className="px-1 text-xs text-red-400">
            {message}
          </p>
        ))}
      </div>
    </SectionCard>
  );
}
