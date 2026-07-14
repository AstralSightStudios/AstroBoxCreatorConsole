set -euo pipefail

cd "$(dirname "$0")/.."

printf '按 S 跳过构建，5 秒后将自动开始构建...\n'

if IFS= read -r -t 5 -n 1 choice && [[ "$choice" =~ ^[sS]$ ]]; then
  printf '\n已跳过构建。\n'
else
  printf '\n开始构建...\n'
  bun tauri build
fi

OUTPUT="${OUTPUT_DIR:-$(pwd)}"
APP_NAME="${APP_NAME:-CreatorConsole}"
APP_VERSION="${APP_VERSION:-$(bun -p "require('./src-tauri/tauri.conf.json').version ?? require('./package.json').version")}"
DMG_NAME="${DMG_NAME:-$APP_NAME-$APP_VERSION.dmg}"
DMG_PATH="$OUTPUT/$DMG_NAME"
MOUNT_NAME="/Volumes/$APP_NAME"
BACKGROUND="${BACKGROUND:-$(pwd)/src-tauri/resources/dmgbg@2x.png}"
SRC="${APP_BUNDLE_PATH:-$(pwd)/src-tauri/target/release/bundle/macos/AstroBox CreatorConsole.app}"
APP_BUNDLE_NAME="$(basename "$SRC")"

if [ -f "$DMG_PATH" ]; then
  echo "发现已有 DMG，正在删除：$DMG_PATH"
  rm -f "$DMG_PATH"
fi

# 卸载之前挂载的 DMG
if [ -d "$MOUNT_NAME" ]; then
  echo "发现已挂载的 DMG，正在卸载..."
  hdiutil detach "$MOUNT_NAME" -force || true
fi

# 重启 Finder，减少视图缓存影响
killall Finder >/dev/null 2>&1 || true
sleep 1

if [ ! -d "$SRC" ]; then
  echo "未找到应用：$SRC"
  echo "请先运行 Tauri 构建。"
  exit 1
fi

if [ ! -f "$BACKGROUND" ]; then
  echo "未找到背景图片：$BACKGROUND"
  exit 1
fi

create-dmg \
  --volname "$APP_NAME" \
  --window-size 400 640 \
  --icon-size 120 \
  --text-size 14 \
  --icon "$APP_BUNDLE_NAME" 200 164 \
  --app-drop-link 200 450 \
  --background "$BACKGROUND" \
  "$DMG_PATH" \
  "$(dirname "$SRC")"

printf '\nDMG 已生成：%s\n' "$DMG_PATH"
