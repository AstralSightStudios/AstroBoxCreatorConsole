import { Switch } from "@radix-ui/themes";
import { SectionCard } from "./shared";

interface ExtSectionProps {
  extRaw: string;
  extError: string;
  enableAstroBoxCreatorFeatures: boolean;
  onChange: (value: string) => void;
  onToggleCreatorFeatures: (value: boolean) => void;
}

export function ExtSection({
  extRaw,
  extError,
  enableAstroBoxCreatorFeatures,
  onChange,
  onToggleCreatorFeatures,
}: ExtSectionProps) {
  return (
    <SectionCard
      title="扩展字段 (ext)"
      description="结构化扩展字段会自动写入 ext；这里的 JSON 仅用于补充其他自定义字段。"
    >
      <div className="rounded-lg border border-white/10 bg-black/20 px-3 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <p className="text-sm font-medium text-white">
              启用购买与资源加密相关功能
            </p>
            <p className="text-xs text-white/60">
              开启后客户端将尝试获取该资源的purchase_info。
            </p>
          </div>
          <Switch
            checked={enableAstroBoxCreatorFeatures}
            onCheckedChange={onToggleCreatorFeatures}
          />
        </div>
      </div>
    </SectionCard>
  );
}
