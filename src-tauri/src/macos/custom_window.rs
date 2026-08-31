use block2::RcBlock;
use dispatch::Queue;
use objc2::rc::Retained;
use objc2::runtime::{Bool, ProtocolObject};
use objc2::{class, msg_send};
use objc2_app_kit::{
    NSLayoutAttribute, NSLayoutConstraint, NSLayoutRelation, NSSplitViewController,
    NSSplitViewItem, NSToolbar, NSView, NSViewController, NSWindow, NSWindowButton,
    NSWindowCollectionBehavior, NSWindowDidResizeNotification, NSWindowStyleMask,
    NSWindowToolbarStyle,
};
use objc2_foundation::{NSArray, NSNotification, NSNotificationCenter, NSPoint, NSRect, NSSize};
use std::ptr::NonNull;
use std::sync::{Mutex, OnceLock};
use std::time::Duration;
use tauri::Manager;

#[allow(dead_code)]
struct ObserverHandle(Retained<ProtocolObject<dyn objc2::runtime::NSObjectProtocol>>);
unsafe impl Send for ObserverHandle {}
unsafe impl Sync for ObserverHandle {}

struct MainThreadWindow(*mut NSWindow);
unsafe impl Send for MainThreadWindow {}

const COMPACT_TITLEBAR_WIDTH_BREAKPOINT: f64 = 400.0;
const STANDARD_TITLEBAR_HEIGHT: f64 = 32.0;
const STANDARD_TRAFFIC_LIGHT_X: f64 = 9.0;
const STANDARD_TRAFFIC_LIGHT_Y: f64 = 9.0;
const IMMERSIVE_TITLEBAR_HEIGHT: f64 = 42.0;
const IMMERSIVE_TRAFFIC_LIGHT_X: f64 = 20.0;
const IMMERSIVE_TRAFFIC_LIGHT_Y: f64 = 9.0;
const TRAFFIC_LIGHT_SPACING: f64 = 23.0;
const TRAFFIC_LIGHT_WATCHDOG_INTERVAL_MS: u64 = 300;

static WINDOW_OBSERVERS: OnceLock<Mutex<Vec<ObserverHandle>>> = OnceLock::new();
static TRAFFIC_LIGHT_WATCHDOG_STARTED: OnceLock<Mutex<bool>> = OnceLock::new();

fn window_observers() -> &'static Mutex<Vec<ObserverHandle>> {
    WINDOW_OBSERVERS.get_or_init(|| Mutex::new(Vec::new()))
}

fn traffic_light_watchdog_started() -> &'static Mutex<bool> {
    TRAFFIC_LIGHT_WATCHDOG_STARTED.get_or_init(|| Mutex::new(false))
}

unsafe fn set_active(constraint: &Retained<NSLayoutConstraint>) {
    let _: () = msg_send![&**constraint, setActive: Bool::YES];
}

unsafe fn pin_to_edges(child: *mut NSView, parent: &NSView) {
    let _: () = msg_send![child, setTranslatesAutoresizingMaskIntoConstraints: Bool::NO];

    let leading: Retained<NSLayoutConstraint> = msg_send![class!(NSLayoutConstraint),
        constraintWithItem: child,
        attribute: NSLayoutAttribute::Leading,
        relatedBy: NSLayoutRelation::Equal,
        toItem: parent,
        attribute: NSLayoutAttribute::Leading,
        multiplier: 1.0,
        constant: 0.0
    ];
    let trailing: Retained<NSLayoutConstraint> = msg_send![class!(NSLayoutConstraint),
        constraintWithItem: child,
        attribute: NSLayoutAttribute::Trailing,
        relatedBy: NSLayoutRelation::Equal,
        toItem: parent,
        attribute: NSLayoutAttribute::Trailing,
        multiplier: 1.0,
        constant: 0.0
    ];
    let top: Retained<NSLayoutConstraint> = msg_send![class!(NSLayoutConstraint),
        constraintWithItem: child,
        attribute: NSLayoutAttribute::Top,
        relatedBy: NSLayoutRelation::Equal,
        toItem: parent,
        attribute: NSLayoutAttribute::Top,
        multiplier: 1.0,
        constant: 0.0
    ];
    let bottom: Retained<NSLayoutConstraint> = msg_send![class!(NSLayoutConstraint),
        constraintWithItem: child,
        attribute: NSLayoutAttribute::Bottom,
        relatedBy: NSLayoutRelation::Equal,
        toItem: parent,
        attribute: NSLayoutAttribute::Bottom,
        multiplier: 1.0,
        constant: 0.0
    ];

    set_active(&leading);
    set_active(&trailing);
    set_active(&top);
    set_active(&bottom);
}

unsafe fn adopt_root_with_toolbar(ns_window: *mut NSWindow) {
    let previous_frame: NSRect = msg_send![ns_window, frame];
    let mut target_size = NSSize {
        width: previous_frame.size.width,
        height: previous_frame.size.height,
    };
    if target_size.width < 600.0 {
        target_size.width = 600.0;
    }
    if target_size.height < 400.0 {
        target_size.height = 400.0;
    }

    let toolbar: Retained<NSToolbar> = msg_send![class!(NSToolbar), new];
    let _: () = msg_send![&*toolbar, setShowsBaselineSeparator: Bool::NO];
    let _: () = msg_send![ns_window, setToolbar: &*toolbar];

    let old_content = (*ns_window).contentView().expect("窗口缺少 contentView");
    let old_content_view = &*old_content;
    let subviews: *mut NSArray<NSView> = msg_send![old_content_view, subviews];
    let count: usize = if subviews.is_null() {
        0
    } else {
        msg_send![subviews, count]
    };
    assert!(count > 0, "窗口 contentView 中缺少 WebView");
    let web_root: *mut NSView = msg_send![subviews, objectAtIndex: 0];
    let _: () = msg_send![web_root, removeFromSuperview];

    let detail_view_controller: Retained<NSViewController> =
        msg_send![class!(NSViewController), new];
    let detail_view: Retained<NSView> = msg_send![class!(NSView), new];
    let _: () = msg_send![&*detail_view, setWantsLayer: Bool::YES];
    let _: () = msg_send![&*detail_view_controller, setView: &*detail_view];
    let _: () = msg_send![&*detail_view, addSubview: web_root];
    pin_to_edges(web_root, &*detail_view);

    let sidebar_view_controller: Retained<NSViewController> =
        msg_send![class!(NSViewController), new];
    let sidebar_view: Retained<NSView> = msg_send![class!(NSView), new];
    let _: () = msg_send![&*sidebar_view, setWantsLayer: Bool::YES];
    let _: () = msg_send![&*sidebar_view_controller, setView: &*sidebar_view];

    let sidebar_min_width: Retained<NSLayoutConstraint> = msg_send![class!(NSLayoutConstraint),
        constraintWithItem: &*sidebar_view,
        attribute: NSLayoutAttribute::Width,
        relatedBy: NSLayoutRelation::GreaterThanOrEqual,
        toItem: core::ptr::null_mut::<objc2::runtime::AnyObject>(),
        attribute: NSLayoutAttribute::NotAnAttribute,
        multiplier: 1.0,
        constant: 1.0
    ];
    set_active(&sidebar_min_width);

    let split_view_controller: Retained<NSSplitViewController> =
        msg_send![class!(NSSplitViewController), new];
    let sidebar_item: Retained<NSSplitViewItem> =
        msg_send![class!(NSSplitViewItem), sidebarWithViewController: &*sidebar_view_controller];
    let detail_item: Retained<NSSplitViewItem> = msg_send![class!(NSSplitViewItem),
        splitViewItemWithViewController: &*detail_view_controller
    ];
    let _: () = msg_send![&*split_view_controller, addSplitViewItem: &*sidebar_item];
    let _: () = msg_send![&*split_view_controller, addSplitViewItem: &*detail_item];
    let _: () = msg_send![&*sidebar_item, setCollapsed: Bool::YES];
    let _: () = msg_send![ns_window, setContentViewController: &*split_view_controller];

    (*ns_window).setContentSize(target_size);
    let _: () = msg_send![ns_window, setContentMinSize: NSSize { width: 320.0, height: 640.0 }];

    let mut style_mask = (*ns_window).styleMask();
    style_mask.insert(NSWindowStyleMask::FullSizeContentView);
    (*ns_window).setStyleMask(style_mask);
    (*ns_window).setCollectionBehavior(NSWindowCollectionBehavior::FullScreenNone);
    (*ns_window).setToolbarStyle(NSWindowToolbarStyle::Unified);
    let _: () = msg_send![ns_window, setTitleVisibility: 1usize];
    let _: () = msg_send![ns_window, setTitlebarAppearsTransparent: Bool::YES];

    let root_view: *mut NSView = msg_send![&*split_view_controller, view];
    let _: () = msg_send![root_view, setTranslatesAutoresizingMaskIntoConstraints: Bool::YES];
    if let Some(content_view) = (*ns_window).contentView() {
        let content_view_ptr = Retained::<NSView>::as_ptr(&content_view);
        let bounds: NSRect = msg_send![content_view_ptr, bounds];
        let _: () = msg_send![root_view, setFrame: bounds];
    }
    let _: () = msg_send![root_view, setAutoresizingMask: 18u64];
    let _: () = msg_send![root_view, setNeedsLayout: Bool::YES];
    let _: () = msg_send![root_view, layoutSubtreeIfNeeded];

    install_resize_chrome_sync(ns_window);
}

unsafe fn apply_traffic_light_layout(ns_window: *mut NSWindow, compact: bool) {
    let window = &*ns_window;
    let Some(close) = window.standardWindowButton(NSWindowButton::CloseButton) else {
        return;
    };
    let Some(miniaturize) = window.standardWindowButton(NSWindowButton::MiniaturizeButton) else {
        return;
    };
    let Some(zoom) = window.standardWindowButton(NSWindowButton::ZoomButton) else {
        return;
    };
    let Some(button_group) = close.superview().and_then(|view| view.superview()) else {
        return;
    };

    let (titlebar_height, button_x, button_y) = if compact {
        (
            STANDARD_TITLEBAR_HEIGHT,
            STANDARD_TRAFFIC_LIGHT_X,
            STANDARD_TRAFFIC_LIGHT_Y,
        )
    } else {
        (
            IMMERSIVE_TITLEBAR_HEIGHT,
            IMMERSIVE_TRAFFIC_LIGHT_X,
            IMMERSIVE_TRAFFIC_LIGHT_Y,
        )
    };

    let mut group_frame = button_group.frame();
    group_frame.size.height = titlebar_height;
    group_frame.origin.y = window.frame().size.height - titlebar_height;
    button_group.setFrame(group_frame);

    for (index, button) in [close, miniaturize, zoom].into_iter().enumerate() {
        button.setFrameOrigin(NSPoint {
            x: button_x + index as f64 * TRAFFIC_LIGHT_SPACING,
            y: button_y,
        });
    }
}

unsafe fn replay_traffic_light_layout(ns_window: *mut NSWindow) {
    let frame: NSRect = msg_send![ns_window, frame];
    apply_traffic_light_layout(
        ns_window,
        frame.size.width < COMPACT_TITLEBAR_WIDTH_BREAKPOINT,
    );
}

fn start_traffic_light_watchdog(ns_window: *mut NSWindow) {
    {
        let mut started = traffic_light_watchdog_started()
            .lock()
            .expect("红绿灯校准 watchdog 状态锁已损坏");
        if *started {
            return;
        }
        *started = true;
    }
    tick_traffic_light_watchdog(MainThreadWindow(ns_window));
}

fn tick_traffic_light_watchdog(window: MainThreadWindow) {
    Queue::main().exec_after(
        Duration::from_millis(TRAFFIC_LIGHT_WATCHDOG_INTERVAL_MS),
        move || unsafe {
            let current = window;
            correct_traffic_light_frame(current.0);
            tick_traffic_light_watchdog(current);
        },
    );
}

unsafe fn correct_traffic_light_frame(ns_window: *mut NSWindow) {
    let window = &*ns_window;
    let Some(close) = window.standardWindowButton(NSWindowButton::CloseButton) else {
        return;
    };
    let Some(miniaturize) = window.standardWindowButton(NSWindowButton::MiniaturizeButton) else {
        return;
    };
    let Some(zoom) = window.standardWindowButton(NSWindowButton::ZoomButton) else {
        return;
    };
    let Some(button_group) = close.superview().and_then(|view| view.superview()) else {
        return;
    };

    let frame: NSRect = msg_send![ns_window, frame];
    let compact = frame.size.width < COMPACT_TITLEBAR_WIDTH_BREAKPOINT;
    let (titlebar_height, button_x, button_y) = if compact {
        (
            STANDARD_TITLEBAR_HEIGHT,
            STANDARD_TRAFFIC_LIGHT_X,
            STANDARD_TRAFFIC_LIGHT_Y,
        )
    } else {
        (
            IMMERSIVE_TITLEBAR_HEIGHT,
            IMMERSIVE_TRAFFIC_LIGHT_X,
            IMMERSIVE_TRAFFIC_LIGHT_Y,
        )
    };
    let mut corrected = false;

    let mut group_frame = button_group.frame();
    let target_group_y = frame.size.height - titlebar_height;
    if (group_frame.size.height - titlebar_height).abs() > 0.5
        || (group_frame.origin.y - target_group_y).abs() > 0.5
    {
        group_frame.size.height = titlebar_height;
        group_frame.origin.y = target_group_y;
        button_group.setFrame(group_frame);
        corrected = true;
    }

    for (index, button) in [close, miniaturize, zoom].into_iter().enumerate() {
        let target_x = button_x + index as f64 * TRAFFIC_LIGHT_SPACING;
        let button_frame = button.frame();
        if (button_frame.origin.x - target_x).abs() > 0.5
            || (button_frame.origin.y - button_y).abs() > 0.5
        {
            button.setFrameOrigin(NSPoint {
                x: target_x,
                y: button_y,
            });
            corrected = true;
        }
    }

    if corrected {
        log::debug!("macOS 红绿灯位置已重新校准");
    }
}

unsafe fn install_resize_chrome_sync(ns_window: *mut NSWindow) {
    let center = NSNotificationCenter::defaultCenter();
    let window_object = &*ns_window as &objc2::runtime::AnyObject;

    start_traffic_light_watchdog(ns_window);
    replay_traffic_light_layout(ns_window);

    let resize_block = RcBlock::new(move |_note: NonNull<NSNotification>| unsafe {
        replay_traffic_light_layout(ns_window);
    });
    let resize_observer = center.addObserverForName_object_queue_usingBlock(
        Some(NSWindowDidResizeNotification),
        Some(window_object),
        None,
        &*resize_block,
    );

    window_observers()
        .lock()
        .expect("窗口 observer 状态锁已损坏")
        .push(ObserverHandle(resize_observer));
}

pub fn adopt_tahoe_round_corners_style(app: &tauri::AppHandle) {
    let app_handle = app.clone();
    app.run_on_main_thread(move || {
        let window = app_handle.get_webview_window("main").expect("找不到主窗口");
        let raw_window = window.ns_window().expect("找不到 macOS 原生窗口");
        let ns_window: *mut NSWindow = raw_window.cast();

        unsafe {
            adopt_root_with_toolbar(ns_window);
        }
    })
    .expect("无法在 macOS 主线程配置窗口");
}
