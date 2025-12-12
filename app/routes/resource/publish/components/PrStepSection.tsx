import { Button, TextArea } from "@radix-ui/themes";
import { PUBLISH_CONFIG } from "~/config/publish";
import { SectionCard } from "./shared";

interface PrStepSectionProps {
    prBody: string;
    prStatus: "idle" | "loading" | "success" | "error";
    prMessage: string;
    onPrBodyChange: (value: string) => void;
    onSubmit: () => void;
    onBack: () => void;
}

export function PrStepSection({
    prBody,
    prStatus,
    prMessage,
    onPrBodyChange,
    onSubmit,
    onBack,
}: PrStepSectionProps) {
    return (
        <SectionCard
            title="步骤 3 · 提交 Pull Request"
            description={`将当前仓库的 ${PUBLISH_CONFIG.defaultBranch} 分支提交到 ${PUBLISH_CONFIG.targetPrRepoOwner}/${PUBLISH_CONFIG.targetPrRepoName}。`}
        >
            <div className="flex flex-col gap-2">
                <TextArea
                    rows={3}
                    placeholder="可填写说明、变更摘要或备注"
                    value={prBody}
                    onChange={(e) => onPrBodyChange(e.target.value)}
                />
                <div className="flex items-center gap-2">
                    <Button
                        className="styledbtn"
                        onClick={onSubmit}
                        disabled={prStatus === "loading"}
                    >
                        {prStatus === "loading" ? "创建中..." : "提交 PR"}
                    </Button>
                    {prMessage && (
                        <p
                            className={`text-sm ${prStatus === "error" ? "text-amber-400" : "text-white/70"}`}
                        >
                            {prMessage}
                        </p>
                    )}
                </div>
                <div className="flex flex-row justify-between pt-2">
                    <Button className="styledbtn" onClick={onBack}>
                        返回上一步
                    </Button>
                </div>
            </div>
        </SectionCard>
    );
}
