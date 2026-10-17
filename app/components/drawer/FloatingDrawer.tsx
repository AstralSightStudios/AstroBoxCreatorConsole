import { useRef, type CSSProperties, type ReactNode } from "react";
import { Drawer } from "vaul";
import { useUiScaleViewport } from "~/components/UiScaleContext";
import DynamicDrawerHandle, {
  type DynamicDrawerHandleRef,
} from "./DynamicDrawerHandle";

export interface FloatingDrawerProps {
  open: boolean;
  onClose: () => void;
  /** 无障碍标题（读屏用，不参与可见布局，可见标题仍由 children 自行渲染）。 */
  title: string;
  /** 无障碍描述。 */
  description?: string;
  /**
   * 桌面端是否使用右侧面板。`true` 时桌面为右侧 aside、窄屏为底部 sheet；
   * `false` 时全平台贴底 sheet。默认 `false`。
   */
  sideOnDesktop?: boolean;
  /** 底部 sheet 面板最大宽度（px），缺省不限宽。 */
  maxWidth?: number;
  /** 拖拽把手无障碍标签，缺省取 `title`。 */
  handleLabel?: string;
  /** 面板内容（头部与滚动区完全由调用方拥有）。 */
  children: ReactNode;
  /** 面板容器附加类名。 */
  panelClassName?: string;
}

const SHEET_PANEL_CLASS =
  "relative z-1 flex h-full w-full flex-col overflow-hidden rounded-t-[28px] border-t-[1.5px] border-[var(--nav-border-strong)] bg-[rgba(0,0,0,0.75)] pt-2.5 text-[color:var(--text-color)] backdrop-blur-md";
const SIDE_PANEL_CLASS =
  "fixed z-[120] flex flex-col overflow-hidden rounded-[18px] text-[color:var(--text-color)] shadow-[var(--nav-panel-shadow)] outline-none";
// vaul 的 [data-vaul-handle] 是无层样式，会压过 Tailwind 分层工具类，故用内联样式覆盖。
const HANDLE_STYLE: CSSProperties = {
  display: "flex",
  height: 15,
  width: 64,
  marginLeft: "auto",
  marginRight: "auto",
  marginBottom: 0,
  alignItems: "center",
  justifyContent: "center",
  background: "transparent",
  opacity: 1,
  color: "var(--floating-panel-handle-bg)",
};

/**
 * 通用浮层抽屉，底层使用 vaul（对齐 AstroBox-NG 的 drawer 逻辑）：
 * - 单个 `Drawer.Root` 通过 `direction` 在底部 sheet 与右侧面板间切换；
 * - 遮罩、进出场动画、拖拽跟手与手势判定全部交给 vaul；
 * - 拖拽把手进度走 `DynamicDrawerHandleRef`，拖拽期间零重渲染。
 */
export default function FloatingDrawer({
  open,
  onClose,
  title,
  description,
  sideOnDesktop = false,
  maxWidth,
  handleLabel,
  children,
  panelClassName,
}: FloatingDrawerProps) {
  const { isDesktop, portalContainer } = useUiScaleViewport();
  const handleRef = useRef<DynamicDrawerHandleRef>(null);

  const useSidePanel = sideOnDesktop && isDesktop;
  const isSheet = !useSidePanel;

  const sheetPanelStyle: CSSProperties | undefined = maxWidth
    ? { maxWidth: `${maxWidth}px` }
    : undefined;
  const sidePanelStyle = {
    top: "max(0.5rem, var(--ui-safe-area-top))",
    bottom: "max(0.5rem, var(--ui-safe-area-bottom))",
    right: "max(0.5rem, var(--ui-safe-area-right))",
    width: 387,
    maxWidth: "calc(100% - 1rem)",
    "--initial-transform":
      "calc(100% + max(0.5rem, var(--ui-safe-area-right)))",
  } as CSSProperties;

  return (
    <Drawer.Root
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onClose();
      }}
      onDrag={(_event, progress) => {
        if (useSidePanel) return;
        handleRef.current?.setProgress(Math.min(Math.max(progress * 2, 0), 1));
      }}
      onRelease={() => handleRef.current?.setProgress(0)}
      onAnimationEnd={() => handleRef.current?.setProgress(0)}
      dismissible
      direction={useSidePanel ? "right" : "bottom"}
      noBodyStyles
      shouldScaleBackground={false}
      setBackgroundColorOnScale={false}
    >
      <Drawer.Portal container={portalContainer ?? undefined}>
        <Drawer.Overlay className="fixed inset-0 z-[110] bg-black/40" />
        {isSheet ? (
          <Drawer.Content
            className="fixed inset-x-0 top-0 z-[120] flex w-full justify-center outline-none"
            style={{
              height: "var(--ui-viewport-height)",
              paddingTop: "max(100px, calc(var(--ui-safe-area-top) + 56px))",
            }}
          >
            {/*
              贴底 sheet 的 Content 是覆盖全屏的容器，可见遮罩区其实落在这个
              Content 内部，vaul 的「点外部关闭」判定不到。这里补一个透明点击层，
              点面板之外的空白（顶部留白、maxWidth 时的两侧）即可关闭抽屉。
            */}
            <div
              role="presentation"
              aria-hidden="true"
              onClick={onClose}
              className="absolute inset-0 z-0 cursor-pointer"
            />
            <Drawer.Title className="sr-only">{title}</Drawer.Title>
            {description ? (
              <Drawer.Description className="sr-only">
                {description}
              </Drawer.Description>
            ) : null}
            <div
              className={`${SHEET_PANEL_CLASS} ${panelClassName ?? ""}`}
              style={sheetPanelStyle}
            >
              <Drawer.Handle
                aria-label={handleLabel ?? title}
                className="tauri-no-drag [&>[data-vaul-handle-hitarea]]:grid [&>[data-vaul-handle-hitarea]]:place-items-center"
                style={HANDLE_STYLE}
              >
                <DynamicDrawerHandle ref={handleRef} direction="down" />
              </Drawer.Handle>
              <div className="relative z-1 flex min-h-0 flex-1 flex-col">
                {children}
              </div>
            </div>
          </Drawer.Content>
        ) : (
          <Drawer.Content
            className={`${SIDE_PANEL_CLASS} ${panelClassName ?? ""}`}
            style={sidePanelStyle}
          >
            <Drawer.Title className="sr-only">{title}</Drawer.Title>
            {description ? (
              <Drawer.Description className="sr-only">
                {description}
              </Drawer.Description>
            ) : null}
            <div
              className="absolute inset-0 rounded-[18px] border border-[var(--nav-border-strong)] backdrop-blur-[40px]"
              style={{ backgroundColor: "rgba(0, 0, 0, 0.5)" }}
            />
            <div className="relative z-1 flex h-full w-full flex-col">
              {children}
            </div>
          </Drawer.Content>
        )}
      </Drawer.Portal>
    </Drawer.Root>
  );
}
