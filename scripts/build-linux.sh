#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
BUNDLE_DIR="$PROJECT_ROOT/src-tauri/target/release/bundle"
OUTPUT_DIR="$PROJECT_ROOT/dist/linux"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

info()  { echo -e "${CYAN}[INFO]${NC} $*"; }
ok()    { echo -e "${GREEN}[ OK ]${NC} $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $*"; }
err()   { echo -e "${RED}[ERR!]${NC} $*"; }

# ============================================================
# 包名常量
# ============================================================

PKG_NAME="astrobox-creator-console"
DEB_PKG_FIELD="astro-box-creator-console"
PRODUCT_FILE_PREFIX="AstroBox CreatorConsole"

# ============================================================
# 包名修改函数
# ============================================================

repackage_deb() {
    local abs_deb="$1"
    local abs_out="$2"
    local temp_dir
    temp_dir=$(mktemp -d)

    echo "  Repackaging $(basename "$abs_deb")..."

    dpkg-deb -R "$abs_deb" "$temp_dir"

    if [ -f "$temp_dir/DEBIAN/control" ]; then
        sed -i "s/^Package: ${DEB_PKG_FIELD}$/Package: ${PKG_NAME}/" "$temp_dir/DEBIAN/control"
        echo "    Modified Package: ${DEB_PKG_FIELD} -> ${PKG_NAME}"
    fi

    dpkg-deb -b --root-owner-group "$temp_dir" "$abs_out"
    rm -rf "$temp_dir" "$abs_deb"
}

repackage_rpm() {
    local abs_rpm="$1"
    local abs_out="$2"
    local build_dir
    build_dir=$(mktemp -d)
    local spec_file="$build_dir/${PKG_NAME}.spec"

    echo "  Repackaging $(basename "$abs_rpm")..."

    local version release
    version=$(rpm -q --qf '%{VERSION}' -p "$abs_rpm" 2>/dev/null || echo "0.0.0")
    release=$(rpm -q --qf '%{RELEASE}' -p "$abs_rpm" 2>/dev/null || echo "1")

    cp "$abs_rpm" "$build_dir/"
    cd "$build_dir"
    rpm2archive "$(basename "$abs_rpm")" -f cpio | gunzip | cpio -idm 2>/dev/null || true

    local content_dir="$build_dir/content"
    mkdir -p "$content_dir"
    for item in "$build_dir"/*; do
        local name
        name=$(basename "$item")
        case "$name" in
            content|"${PKG_NAME}.spec"|rpmbuild|*.rpm|SPECPARTS) continue ;;
            *) mv "$item" "$content_dir/" ;;
        esac
    done

    # rpm 的 %files 按空白分词，desktop 等含空格的文件名需转义，
    # 否则 rpmbuild 会报 "File must begin with /" 并触发静默降级。
    local file_list_file="$build_dir/filelist"
    (cd "$content_dir" && find . -type f | sed 's|^\.||' | sed 's/ /\\ /g') > "$file_list_file"

    cat > "$spec_file" << EOF
Name: ${PKG_NAME}
Version: $version
Release: $release
Summary: AstroBox CreatorConsole - Creator Console for AstroBox ecosystem
License: AGPL-3.0
Group: Applications/System

%description
AstroBox CreatorConsole is an all-in-one creator console for the AstroBox ecosystem.

%install
mkdir -p %{buildroot}
cp -a $content_dir/* %{buildroot}/

%files -f $file_list_file
EOF

    mkdir -p "$build_dir/rpmbuild"/{BUILD,RPMS,SOURCES,SPECS,SRPMS}

    local build_log
    build_log=$(rpmbuild --define "_topdir $build_dir/rpmbuild" \
                         -bb "$spec_file" 2>&1) || {
        echo "    Warning: rpmbuild failed, falling back to simple rename"
        echo "$build_log" | tail -20
        cp "$abs_rpm" "$abs_out"
        rm -rf "$build_dir"
        return
    }

    local new_rpm
    new_rpm=$(find "$build_dir/rpmbuild/RPMS" -name "${PKG_NAME}-*.rpm" -type f | head -1)
    if [ -n "$new_rpm" ]; then
        mv "$new_rpm" "$abs_out"
        rm -f "$abs_rpm"
    else
        echo "    Warning: Could not find repackaged rpm, falling back to simple rename"
        cp "$abs_rpm" "$abs_out"
    fi

    rm -rf "$build_dir"
}

step_repackage() {
    echo ""
    info "=========================================="
    info "Step 2/3: 重命名 Linux 包 (${PKG_NAME})"
    info "=========================================="

    if [ -d "$BUNDLE_DIR/deb" ]; then
        info "处理 deb 包..."
        cd "$BUNDLE_DIR/deb"
        for deb_file in "${PRODUCT_FILE_PREFIX}_"*.deb; do
            [ -f "$deb_file" ] || continue
            local version arch
            version=$(echo "$deb_file" | grep -oP '\d+\.\d+\.\d+')
            arch=$(echo "$deb_file" | grep -oP 'amd64|arm64|armhf')
            [ -n "$version" ] && [ -n "$arch" ] || continue
            repackage_deb "$BUNDLE_DIR/deb/$deb_file" "$BUNDLE_DIR/deb/${PKG_NAME}_${version}_${arch}.deb"
        done
        for dir in "${PRODUCT_FILE_PREFIX}_"*; do
            [ -d "$dir" ] || continue
            local new_dir
            new_dir=$(echo "$dir" | sed "s/^${PRODUCT_FILE_PREFIX}_/${PKG_NAME}_/")
            echo "  Renaming directory $dir -> $new_dir"
            rm -rf "$new_dir"
            mv "$dir" "$new_dir"
        done
    fi

    if [ -d "$BUNDLE_DIR/rpm" ]; then
        info "处理 rpm 包..."
        cd "$BUNDLE_DIR/rpm"
        for rpm_file in "${PRODUCT_FILE_PREFIX}-"*.rpm; do
            [ -f "$rpm_file" ] || continue
            local version release arch
            version=$(echo "$rpm_file" | grep -oP '\d+\.\d+\.\d+')
            release=$(echo "$rpm_file" | grep -oP '\d+\.\d+\.\d+-\K\d+')
            arch=$(echo "$rpm_file" | grep -oP 'x86_64|aarch64|armv7hl')
            [ -n "$version" ] && [ -n "$arch" ] || continue
            repackage_rpm "$BUNDLE_DIR/rpm/$rpm_file" "$BUNDLE_DIR/rpm/${PKG_NAME}-${version}-${release:-1}.${arch}.rpm"
        done
        for dir in "${PRODUCT_FILE_PREFIX}-"*; do
            [ -d "$dir" ] || continue
            local new_dir
            new_dir=$(echo "$dir" | sed "s/^${PRODUCT_FILE_PREFIX}-/${PKG_NAME}-/")
            echo "  Renaming directory $dir -> $new_dir"
            rm -rf "$new_dir"
            mv "$dir" "$new_dir"
        done
    fi

    if [ -d "$BUNDLE_DIR/appimage" ]; then
        info "重命名 AppImage 产物..."
        cd "$BUNDLE_DIR/appimage"
        for appimage_file in "${PRODUCT_FILE_PREFIX}_"*.AppImage; do
            [ -f "$appimage_file" ] || continue
            local version arch
            version=$(echo "$appimage_file" | grep -oP '\d+\.\d+\.\d+')
            arch=$(echo "$appimage_file" | grep -oP 'x86_64|aarch64|armv7hl|amd64|arm64')
            [ -n "$version" ] && [ -n "$arch" ] || continue
            local new_name="${PKG_NAME}_${version}_${arch}.AppImage"
            echo "  Renaming $appimage_file -> $new_name"
            mv "$appimage_file" "$new_name"
        done
    fi

    ok "包重命名完成"
}

# ============================================================
# 交互菜单
# ============================================================

show_menu() {
    echo ""
    echo -e "${BOLD}========================================${NC}"
    echo -e "${BOLD}  AstroBox CreatorConsole Linux 打包工具${NC}"
    echo -e "${BOLD}========================================${NC}"
    echo ""
    echo "请选择要构建的包类型（可多选，用空格分隔）："
    echo ""
    echo -e "  ${BOLD}1)${NC} deb      - Debian/Ubuntu 包"
    echo -e "  ${BOLD}2)${NC} rpm      - Fedora/RHEL 包"
    echo -e "  ${BOLD}3)${NC} arch     - Arch Linux 包 (prebuilt，快速)"
    echo -e "  ${BOLD}4)${NC} appimage - AppImage 包"
    echo ""
    echo -e "  ${BOLD}a)${NC} 全部构建 (deb + rpm + arch + appimage)"
    echo -e "  ${BOLD}q)${NC} 退出"
    echo ""
}

prompt_selection() {
    local prompt="$1"
    shift
    local selected=()

    echo -e "$prompt"

    while true; do
        echo -n "> "
        read -r input

        if [[ "$input" == "q" || "$input" == "Q" ]]; then
            echo ""
            return 1
        fi

        if [[ -z "$input" ]]; then
            break
        fi

        IFS=' ' read -ra tokens <<< "$input"
        selected=()

        for token in "${tokens[@]}"; do
            case "$token" in
                1|deb)       selected+=("deb") ;;
                2|rpm)       selected+=("rpm") ;;
                3|arch)      selected+=("arch") ;;
                4|appimage)  selected+=("appimage") ;;
                a|A)         selected=("deb" "rpm" "arch" "appimage") ;;
                *)
                    err "无效选项: $token"
                    continue ;;
            esac
        done

        if [ ${#selected[@]} -gt 0 ]; then
            SELECTED_TARGETS=("${selected[@]}")
            return 0
        fi
    done

    SELECTED_TARGETS=()
    return 0
}

usage() {
    echo "用法: $0 [选项] [目标...]"
    echo ""
    echo "目标:"
    echo "  deb       - Debian/Ubuntu 包"
    echo "  rpm       - Fedora/RHEL 包"
    echo "  arch      - Arch Linux 包 (prebuilt，快速)"
    echo "  appimage  - AppImage 包"
    echo "  a         - 全部构建 (deb + rpm + arch + appimage)"
    echo ""
    echo "选项:"
    echo "  --no-build   跳过 Tauri 构建（CI 中已构建产物时使用）"
    echo ""
    echo "示例:"
    echo "  $0                    # 交互菜单"
    echo "  $0 deb rpm arch appimage  # 非交互，构建全部四种包"
    echo "  $0 --no-build deb rpm appimage # CI 中仅重命名 deb/rpm/appimage"
    exit 0
}

# ============================================================
# 依赖检查
# ============================================================

check_deps() {
    local missing=()

    command -v bun >/dev/null 2>&1 || missing+=("bun")

    if [[ " ${SELECTED_TARGETS[*]} " =~ " deb " ]]; then
        command -v dpkg-deb >/dev/null 2>&1 || missing+=("dpkg-deb")
    fi

    if [[ " ${SELECTED_TARGETS[*]} " =~ " rpm " ]]; then
        command -v rpmbuild >/dev/null 2>&1 || missing+=("rpmbuild")
        command -v rpm2archive >/dev/null 2>&1 || missing+=("rpm2archive")
    fi

    if [[ " ${SELECTED_TARGETS[*]} " =~ " arch " ]]; then
        command -v makepkg >/dev/null 2>&1 || missing+=("makepkg")
    fi

    if [ ${#missing[@]} -gt 0 ]; then
        err "缺少以下依赖: ${missing[*]}"
        exit 1
    fi
}

# ============================================================
# 构建步骤
# ============================================================

step_build() {
    echo ""
    info "=========================================="
    info "Step 1/3: 运行 bun tauri build"
    info "=========================================="

    cd "$PROJECT_ROOT"

    # Arch Linux 系统库带有 .relr.dyn 段，linuxdeploy 内嵌的旧版 strip 无法解析，
    # 会导致 AppImage 打包失败（failed to run linuxdeploy）。
    # 这里仅在 Arch + 选择 appimage 时跳过 strip，不影响其他平台/包类型。
    if [[ " ${SELECTED_TARGETS[*]} " =~ " appimage " ]] && grep -q '^ID=arch' /etc/os-release 2>/dev/null; then
        export NO_STRIP=1
        warn "检测到 Arch Linux + AppImage：设置 NO_STRIP=1 以绕过 linuxdeploy 的 .relr.dyn 兼容问题"
    fi

    local bundles=()
    local has_native_bundle=false
    for target in "${SELECTED_TARGETS[@]}"; do
        case "$target" in
            deb)      bundles+=("deb"); has_native_bundle=true ;;
            rpm)      bundles+=("rpm"); has_native_bundle=true ;;
            appimage) bundles+=("appimage"); has_native_bundle=true ;;
        esac
    done

    if [ "$has_native_bundle" = true ]; then
        local bundle_arg
        bundle_arg=$(IFS=,; echo "${bundles[*]}")
        bun tauri build --bundles "$bundle_arg"
    else
        info "没有需要 native bundler 的目标，仅编译项目（--no-bundle）"
        bun tauri build --no-bundle
    fi

    ok "Tauri 构建完成"
}

build_deb() {
    echo ""
    info "--- 收集 deb 包 ---"

    local deb_files
    deb_files=$(find "$BUNDLE_DIR/deb" -name "${PKG_NAME}_*.deb" -type f 2>/dev/null)

    if [ -z "$deb_files" ]; then
        warn "未找到 deb 包"
        return
    fi

    mkdir -p "$OUTPUT_DIR"
    while IFS= read -r f; do
        cp "$f" "$OUTPUT_DIR/$(basename "$f")"
        ok "$OUTPUT_DIR/$(basename "$f")"
    done <<< "$deb_files"
}

build_rpm() {
    echo ""
    info "--- 收集 rpm 包 ---"

    local rpm_files
    rpm_files=$(find "$BUNDLE_DIR/rpm" -name "${PKG_NAME}-*.rpm" -type f 2>/dev/null)

    if [ -z "$rpm_files" ]; then
        warn "未找到 rpm 包"
        return
    fi

    mkdir -p "$OUTPUT_DIR"
    while IFS= read -r f; do
        cp "$f" "$OUTPUT_DIR/$(basename "$f")"
        ok "$OUTPUT_DIR/$(basename "$f")"
    done <<< "$rpm_files"
}

build_appimage() {
    echo ""
    info "--- 收集 AppImage 包 ---"

    local appimage_files
    appimage_files=$(find "$BUNDLE_DIR/appimage" -name "${PKG_NAME}_*.AppImage" -type f 2>/dev/null)

    if [ -z "$appimage_files" ]; then
        warn "未找到 AppImage 包"
        return
    fi

    mkdir -p "$OUTPUT_DIR"
    while IFS= read -r f; do
        cp "$f" "$OUTPUT_DIR/$(basename "$f")"
        ok "$OUTPUT_DIR/$(basename "$f")"
    done <<< "$appimage_files"
}

build_arch() {
    local mode="$1"
    echo ""
    info "--- 构建 Arch Linux 包 ($mode) ---"

    "$SCRIPT_DIR/archpkg/build.sh" "$mode"

    mkdir -p "$OUTPUT_DIR"
    local arch_pkgs
    arch_pkgs=$(find "$SCRIPT_DIR/archpkg" -maxdepth 1 -name "${PKG_NAME}-*.pkg.tar.zst" ! -name "*debug*" -type f 2>/dev/null)
    if [ -n "$arch_pkgs" ]; then
        while IFS= read -r f; do
            cp "$f" "$OUTPUT_DIR/$(basename "$f")"
            ok "$OUTPUT_DIR/$(basename "$f")"
        done <<< "$arch_pkgs"
    fi
}

# ============================================================
# 参数解析与主流程
# ============================================================

SELECTED_TARGETS=()
INTERACTIVE=true
NO_BUILD=false

for arg in "$@"; do
    case "$arg" in
        --help|-h)
            usage
            ;;
        --no-build)
            NO_BUILD=true
            ;;
        deb|rpm|arch|appimage|a|A)
            INTERACTIVE=false
            case "$arg" in
                deb)      SELECTED_TARGETS+=("deb") ;;
                rpm)      SELECTED_TARGETS+=("rpm") ;;
                arch)     SELECTED_TARGETS+=("arch") ;;
                appimage) SELECTED_TARGETS+=("appimage") ;;
                a|A)      SELECTED_TARGETS=("deb" "rpm" "arch" "appimage") ;;
            esac
            ;;
        *)
            err "未知参数: $arg"
            usage
            ;;
    esac
done

if [ "$INTERACTIVE" = true ]; then
    show_menu
    prompt_selection "输入选项编号（如: 1 2 3 或 deb rpm arch）："
    selection_rc=$?
    if [ $selection_rc -ne 0 ] || [ ${#SELECTED_TARGETS[@]} -eq 0 ]; then
        info "已取消"
        exit 0
    fi
fi

echo ""
info "已选择: ${SELECTED_TARGETS[*]}"
check_deps

if [ "$NO_BUILD" = false ]; then
    step_build
fi

# arch prebuilt 必须在重命名之前执行，因为 PKGBUILD.prebuilt 依赖原始 deb 目录
for target in "${SELECTED_TARGETS[@]}"; do
    case "$target" in
        arch)      build_arch prebuilt ;;
    esac
done

# 只有选中的目标包含 deb 或 rpm 时才执行重命名
has_native_target=false
for target in "${SELECTED_TARGETS[@]}"; do
    case "$target" in
        deb|rpm|appimage) has_native_target=true; break ;;
    esac
done

if [ "$has_native_target" = true ]; then
    step_repackage
fi

mkdir -p "$OUTPUT_DIR"

for target in "${SELECTED_TARGETS[@]}"; do
    case "$target" in
        deb)       build_deb ;;
        rpm)       build_rpm ;;
        appimage)  build_appimage ;;
    esac
done

echo ""
echo -e "${BOLD}========================================${NC}"
ok "全部完成！输出目录: $OUTPUT_DIR"
echo -e "${BOLD}========================================${NC}"
echo ""
ls -lh "$OUTPUT_DIR"/ 2>/dev/null
