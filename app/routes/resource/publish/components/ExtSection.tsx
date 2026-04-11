import { Switch, TextArea } from "@radix-ui/themes";
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
      className="border-0! bg-transparent! rounded-none! shadow-none!"
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
      <TextArea
        rows={4}
        placeholder='例如 {"theme":"dark"}'
        value={extRaw}
        onChange={(e) => onChange(e.target.value)}
      />
      {extError && <p className="text-sm text-amber-400">{extError}</p>}
      {!extError && (
        <div className="flex flex-col px-1.5 py-1 w-full">
          <p className="text-xs text-white/60">
            提交时会与结构化字段自动合并后写入
            <code className="mx-1 rounded bg-white/10 px-1.5 py-0.5 text-[11px]">
              manifest_v2.json
            </code>
            。
          </p>
        </div>
      )}
    </SectionCard>
  );
}
