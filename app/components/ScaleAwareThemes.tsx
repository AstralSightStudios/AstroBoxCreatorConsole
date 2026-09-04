import {
    AlertDialog as BaseAlertDialog,
    ContextMenu as BaseContextMenu,
    Dialog as BaseDialog,
    DropdownMenu as BaseDropdownMenu,
    HoverCard as BaseHoverCard,
    Popover as BasePopover,
    Select as BaseSelect,
    Tooltip as BaseTooltip,
} from "@radix-ui/themes";
import {
    forwardRef,
    type ComponentPropsWithoutRef,
    type ComponentRef,
} from "react";
import { useUiScaleViewport } from "~/components/UiScaleContext";

// 将 Radix 浮层统一挂载到缩放视口
function usePortalContainer(
    explicitContainer?: Element | DocumentFragment | null,
) {
    const { portalContainer } = useUiScaleViewport();
    return explicitContainer ?? portalContainer ?? undefined;
}

const DialogContent = forwardRef<
    ComponentRef<typeof BaseDialog.Content>,
    ComponentPropsWithoutRef<typeof BaseDialog.Content>
>(function DialogContent({ container, ...props }, ref) {
    return (
        <BaseDialog.Content
            {...props}
            ref={ref}
            container={usePortalContainer(container)}
        />
    );
});

const AlertDialogContent = forwardRef<
    ComponentRef<typeof BaseAlertDialog.Content>,
    ComponentPropsWithoutRef<typeof BaseAlertDialog.Content>
>(function AlertDialogContent({ container, ...props }, ref) {
    return (
        <BaseAlertDialog.Content
            {...props}
            ref={ref}
            container={usePortalContainer(container)}
        />
    );
});

const PopoverContent = forwardRef<
    ComponentRef<typeof BasePopover.Content>,
    ComponentPropsWithoutRef<typeof BasePopover.Content>
>(function PopoverContent({ container, ...props }, ref) {
    return (
        <BasePopover.Content
            {...props}
            ref={ref}
            container={usePortalContainer(container)}
        />
    );
});

const DropdownMenuContent = forwardRef<
    ComponentRef<typeof BaseDropdownMenu.Content>,
    ComponentPropsWithoutRef<typeof BaseDropdownMenu.Content>
>(function DropdownMenuContent({ container, ...props }, ref) {
    return (
        <BaseDropdownMenu.Content
            {...props}
            ref={ref}
            container={usePortalContainer(container)}
        />
    );
});

const DropdownMenuSubContent = forwardRef<
    ComponentRef<typeof BaseDropdownMenu.SubContent>,
    ComponentPropsWithoutRef<typeof BaseDropdownMenu.SubContent>
>(function DropdownMenuSubContent({ container, ...props }, ref) {
    return (
        <BaseDropdownMenu.SubContent
            {...props}
            ref={ref}
            container={usePortalContainer(container)}
        />
    );
});

const SelectContent = forwardRef<
    ComponentRef<typeof BaseSelect.Content>,
    ComponentPropsWithoutRef<typeof BaseSelect.Content>
>(function SelectContent({ container, ...props }, ref) {
    return (
        <BaseSelect.Content
            {...props}
            ref={ref}
            container={usePortalContainer(container)}
        />
    );
});

const Tooltip = forwardRef<
    ComponentRef<typeof BaseTooltip>,
    ComponentPropsWithoutRef<typeof BaseTooltip>
>(function Tooltip({ container, ...props }, ref) {
    return (
        <BaseTooltip
            {...props}
            ref={ref}
            container={usePortalContainer(container)}
        />
    );
});

const ContextMenuContent = forwardRef<
    ComponentRef<typeof BaseContextMenu.Content>,
    ComponentPropsWithoutRef<typeof BaseContextMenu.Content>
>(function ContextMenuContent({ container, ...props }, ref) {
    return (
        <BaseContextMenu.Content
            {...props}
            ref={ref}
            container={usePortalContainer(container)}
        />
    );
});

const ContextMenuSubContent = forwardRef<
    ComponentRef<typeof BaseContextMenu.SubContent>,
    ComponentPropsWithoutRef<typeof BaseContextMenu.SubContent>
>(function ContextMenuSubContent({ container, ...props }, ref) {
    return (
        <BaseContextMenu.SubContent
            {...props}
            ref={ref}
            container={usePortalContainer(container)}
        />
    );
});

const HoverCardContent = forwardRef<
    ComponentRef<typeof BaseHoverCard.Content>,
    ComponentPropsWithoutRef<typeof BaseHoverCard.Content>
>(function HoverCardContent({ container, ...props }, ref) {
    return (
        <BaseHoverCard.Content
            {...props}
            ref={ref}
            container={usePortalContainer(container)}
        />
    );
});

export const Dialog = { ...BaseDialog, Content: DialogContent };
export const AlertDialog = { ...BaseAlertDialog, Content: AlertDialogContent };
export const Popover = { ...BasePopover, Content: PopoverContent };
export const DropdownMenu = {
    ...BaseDropdownMenu,
    Content: DropdownMenuContent,
    SubContent: DropdownMenuSubContent,
};
export const Select = { ...BaseSelect, Content: SelectContent };
export const ContextMenu = {
    ...BaseContextMenu,
    Content: ContextMenuContent,
    SubContent: ContextMenuSubContent,
};
export const HoverCard = { ...BaseHoverCard, Content: HoverCardContent };
export { Tooltip };
export * from "@radix-ui/themes";
