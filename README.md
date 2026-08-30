<p align="center">
    <img width="64" height="64" alt="AstroBox CreatorConsole 图标" src="src-tauri/icons/icon.png" />
</p>
<h1 align="center">AstroBox CreatorConsole</h1>
<p align="center">把复杂统统留在背后 — AstroBox 生态的创作者控制台，聚焦资源的发布、运营与数据分析。</p>
<p align="center">
    <a href="https://github.com/AstralSightStudios/AstroBox-NG">AstroBox-NG</a> ·
    <a href="src-tauri">Rust Workspace</a> ·
    <a href="app">Web 前端</a>
</p>
<p align="center">
    <img src="https://img.shields.io/badge/rust-1.77.2%20+-orange.svg?style=flat-square" alt="Rust 1.77.2+">
    <img src="https://img.shields.io/badge/tauri-v2-lightgrey.svg?style=flat-square" alt="Tauri v2">
    <img src="https://img.shields.io/badge/bun-required-02ACFA.svg?style=flat-square" alt="bun required">
    <img src="https://img.shields.io/badge/react-19-61DAFB.svg?style=flat-square" alt="React 19">
</p>

---

> 这是面向 AstroBox 创作者与运营团队的一体化控制台，提供从资源发布、加解密与激活，到数据分析和社区互动的完整工作流。

## 技术特性
1. 基于 Tauri v2 构建的跨平台桌面客户端，支持 Windows、macOS、Linux 与 Android 平台
2. 现代化 Web 前端，基于 React 19 + Vite + Tailwind CSS，风格与 AstroBox 生态保持统一
3. 完整资源发布流水线：通过 GitHub PR 自动提交资源、媒体与下载文件，并支持付费映射与加密校验
4. 资源加解密与激活：内置 AES/ECB 加密能力，可对资源进行加密、激活与授权管理
5. 数据分析与概览：下载趋势、区域热力、评分分布等数据看板，帮助创作者掌握资源表现
6. 互动管理：集中处理名下资源的评论与回复，维护创作者与用户之间的沟通
7. 运营与管理后台：PR 审核、云控与资源推流、探索页管理，以及账号、订单、举报、信箱与热更新等后台能力
8. 基于 Casdoor 与 GitHub OAuth 的双账号体系，桌面端通过 `astroboxcc://` 深链完成安全登录

## 项目架构
仓库采用「Rust 核心 + Web 前端」的 Tauri 分层结构，并通过 GitHub Actions 在 macOS、Ubuntu、Windows 上自动构建产物：

```
├── app/          # React 19 前端（Vite + Tailwind CSS）
├── src-tauri/    # Rust / Tauri v2 桌面端壳与插件
├── scripts/      # 平台构建脚本（Android APK / macOS DMG）
├── tests/        # 业务逻辑单元测试
└── .github/      # GitHub Actions 多平台 CI
```

## 快速上手

### 环境要求
- Rust Toolchain 1.77.2+
- Node.js 与 [bun](https://bun.sh/)（**强制使用 bun**）
- Git

### 克隆仓库
```shell
git clone https://github.com/AstralSightStudios/AstroBoxCreatorConsole
cd AstroBoxCreatorConsole
```

### 安装依赖
```shell
bun install
```

### 启动开发环境
```shell
bun run dev          # 仅前端，访问 http://localhost:5173
bun tauri dev        # Tauri 桌面应用（含前端）
```

## 构建

### 桌面端
```shell
bun run build        # 构建前端产物
bun tauri build      # 构建桌面应用
```

### Android
```shell
bun run android            # release 构建（aarch64）
bun run android:debug      # debug 构建（aarch64）
```

### macOS DMG
```shell
bash ./scripts/build_dmg.sh
```

### Linux 与 AUR
```shell
./scripts/build-linux.sh   # deb / rpm / arch / appimage 四种包，统一命名为 astrobox-creator-console
```

构建细节与 AUR 发布流程（`scripts/archpkg/`）见 [scripts/archpkg/README.md](scripts/archpkg/README.md)。

## 测试
```shell
bun test                                            # 前端业务逻辑测试
cargo test --manifest-path src-tauri/Cargo.toml     # Rust 侧测试
```
