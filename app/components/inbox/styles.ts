export const plainCloseButtonClass =
  "tauri-no-drag flex size-[36px] items-center justify-center rounded-full bg-transparent text-white/70 transition-opacity hover:opacity-100";

export const iconButtonClass =
  "tauri-no-drag inline-flex size-[36px] items-center justify-center rounded-full bg-transparent text-white/70 transition-[background-color,opacity] hover:bg-[var(--nav-btn-bg)] hover:opacity-100 active:bg-[var(--nav-indicator)]";

const panelButtonBaseClass =
  "tauri-no-drag inline-flex h-9 items-center justify-center gap-1.5 rounded-full px-3 text-[14px] font-[500] text-white transition-[transform,background-color,opacity] disabled:pointer-events-none disabled:opacity-45";

export const panelButtonQuietClass = `${panelButtonBaseClass} bg-[var(--nav-btn-bg)] hover:bg-[var(--nav-indicator)] active:bg-[var(--nav-indicator-active)]`;
export const panelButtonActiveClass = `${panelButtonBaseClass} bg-[var(--nav-active-bg)] text-white hover:bg-[var(--nav-active-bg-hover)] active:bg-[var(--nav-active-bg-active)]`;
export const panelButtonDangerClass = `${panelButtonBaseClass} bg-red-500/15 text-red-300 hover:opacity-90 active:opacity-100`;

export const appleStackTransition = {
  duration: 0.42,
  ease: [0.32, 0.72, 0, 1] as const,
};

export const cardExpandTransition = {
  duration: 0.32,
  ease: [0.21, 0.79, 0.44, 1] as const,
};

export const collapsedTranslateYMap = [0, 8, 15] as const;
