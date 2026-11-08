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
    createContext,
    forwardRef,
    useCallback,
    useContext,
    useRef,
    type ComponentPropsWithoutRef,
    type ComponentRef,
} from "react";
import { useUiScaleViewport } from "~/components/UiScaleContext";
import { useOverlayHistoryDismiss } from "~/logic/ui/overlay-history";

// 将 Radix 浮层统一挂载到缩放视口
function usePortalContainer(
    explicitContainer?: Element | DocumentFragment | null,
) {
    const { portalContainer } = useUiScaleViewport();
    return explicitContainer ?? portalContainer ?? undefined;
}

/**
 * 受控弹窗的关闭回调。Dialog.Content 只在真正打开时挂载，因此可以把
 * “系统返回手势关闭弹窗”统一收口到包装层，避免每个业务弹窗单独接历史记录。
 */
const DialogDismissContext = createContext<(() => void) | null>(null);

function DialogRoot({
    open,
    onOpenChange,
    children,
    ...props
}: ComponentPropsWithoutRef<typeof BaseDialog.Root>) {
    const onOpenChangeRef = useRef(onOpenChange);
    onOpenChangeRef.current = onOpenChange;
    const dismiss = useCallback(() => {
        onOpenChangeRef.current?.(false);
    }, []);
    // 只接管受控弹窗：非受控弹窗（靠 Trigger 自己开关）没有可靠的关闭入口，
    // 贸然压入历史记录会导致返回后弹窗仍在、历史记录却已经没了的怪异状态。
    const controlledDismiss =
        onOpenChange && open !== undefined ? dismiss : null;

    return (
        <DialogDismissContext.Provider value={controlledDismiss}>
            <BaseDialog.Root
                {...props}
                open={open}
                onOpenChange={onOpenChange}
            >
                {children}
            </BaseDialog.Root>
        </DialogDismissContext.Provider>
    );
}

const AlertDialogDismissContext = createContext<(() => void) | null>(null);

function AlertDialogRoot({
    open,
    onOpenChange,
    children,
    ...props
}: ComponentPropsWithoutRef<typeof BaseAlertDialog.Root>) {
    const onOpenChangeRef = useRef(onOpenChange);
    onOpenChangeRef.current = onOpenChange;
    const dismiss = useCallback(() => {
        onOpenChangeRef.current?.(false);
    }, []);
    const controlledDismiss =
        onOpenChange && open !== undefined ? dismiss : null;

    return (
        <AlertDialogDismissContext.Provider value={controlledDismiss}>
            <BaseAlertDialog.Root
                {...props}
                open={open}
                onOpenChange={onOpenChange}
            >
                {children}
            </BaseAlertDialog.Root>
        </AlertDialogDismissContext.Provider>
    );
}

const DialogContent = forwardRef<
    ComponentRef<typeof BaseDialog.Content>,
    ComponentPropsWithoutRef<typeof BaseDialog.Content>
>(function DialogContent({ container, ...props }, ref) {
    const dismiss = useContext(DialogDismissContext);
    // 受控弹窗打开期间，系统返回手势只关闭弹窗，不退回上一级路由。
    useOverlayHistoryDismiss(Boolean(dismiss), () => dismiss?.());
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
    const dismiss = useContext(AlertDialogDismissContext);
    // 确认框同样优先响应返回手势；没有 onOpenChange 的调用保持原行为。
    useOverlayHistoryDismiss(Boolean(dismiss), () => dismiss?.());
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

export const Dialog = {
    ...BaseDialog,
    Root: DialogRoot,
    Content: DialogContent,
};
export const AlertDialog = {
    ...BaseAlertDialog,
    Root: AlertDialogRoot,
    Content: AlertDialogContent,
};
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
