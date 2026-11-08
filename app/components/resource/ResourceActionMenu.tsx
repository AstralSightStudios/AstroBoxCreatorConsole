import {
    CopyIcon,
    DotsThree,
    GithubLogoIcon,
    PencilSimpleIcon,
    TrashIcon,
} from "@phosphor-icons/react";
import { toast } from "sonner";
import { Button, DropdownMenu } from "~/components/ScaleAwareThemes";
import { isLegacyItemId } from "~/logic/publish/resource-deletion";
import type { ResourceCatalogContext } from "~/logic/publish/resources";
import { openExternal } from "~/routes/manage-resources/components/ResourceVisuals";

export function ResourceActionMenu({
    item,
    disabled,
    onEdit,
    onDelete,
}: {
    item: ResourceCatalogContext;
    disabled?: boolean;
    onEdit: () => void;
    onDelete: () => void;
}) {
    const entry = item.entry;
    const legacy = isLegacyItemId(entry.id);
    const repoUrl = `https://github.com/${entry.repo_owner}/${entry.repo_name}`;

    return (
        <DropdownMenu.Root>
            <DropdownMenu.Trigger>
                <Button
                    type="button"
                    variant="ghost"
                    color="gray"
                    className="size-8 shrink-0 p-0!"
                    aria-label="资源操作"
                    title="资源操作"
                    disabled={disabled}
                    onClick={(event) => event.stopPropagation()}
                >
                    <DotsThree size={18} weight="bold" />
                </Button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Content
                align="end"
                onClick={(event) => event.stopPropagation()}
            >
                <DropdownMenu.Item
                    className="gap-2"
                    disabled={legacy || disabled}
                    title={
                        legacy
                            ? "旧版资源（LegacyItem）暂不支持在控制台编辑"
                            : undefined
                    }
                    onSelect={onEdit}
                >
                    <PencilSimpleIcon size={15} />
                    编辑资源
                </DropdownMenu.Item>
                <DropdownMenu.Item
                    className="gap-2"
                    disabled={disabled}
                    onSelect={() => openExternal(repoUrl)}
                >
                    <GithubLogoIcon size={15} weight="duotone" />
                    打开仓库
                </DropdownMenu.Item>
                <DropdownMenu.Item
                    className="gap-2"
                    disabled={disabled}
                    onSelect={() => {
                        void navigator.clipboard.writeText(entry.id).then(
                            () => toast.success("已复制"),
                            () => toast.error("复制失败"),
                        );
                    }}
                >
                    <CopyIcon size={15} />
                    复制资源 ID
                </DropdownMenu.Item>
                <DropdownMenu.Separator />
                <DropdownMenu.Item
                    className="gap-2"
                    color="red"
                    disabled={disabled}
                    onSelect={onDelete}
                >
                    <TrashIcon size={15} />
                    删除资源…
                </DropdownMenu.Item>
            </DropdownMenu.Content>
        </DropdownMenu.Root>
    );
}
