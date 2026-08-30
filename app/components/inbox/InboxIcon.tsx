import { PackageIcon } from "@phosphor-icons/react";

/**
 * 信箱消息图标。当前信箱只展示 cc-notice（资源审核通知），
 * 因此统一使用资源包图标，已读时降透明度（样式对齐 ABNG）。
 */
export default function InboxIcon({ read }: { read: boolean }) {
  return (
    <PackageIcon
      size={22}
      weight="fill"
      className={read ? "opacity-40 text-white/60" : "opacity-80 text-white"}
    />
  );
}
