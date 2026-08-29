# 生成式人工智能代理项目守则
如果你是一名人类贡献者，则无需阅读此文。本文针对如OpenAI Codex、Trae等Agent类生成式人工智能编码工具介绍本项目，并对如何修改、测试、编译项目做出规范化处理。

## 项目介绍
该项目名为AstroBox CreatorConsole（简称ABCC或者CC），是AstroBox生态系统的一体化创作者控制台，面向创作者与运营团队，提供从资源发布、加解密与激活，到数据分析和社区互动的完整工作流。项目使用Tauri v2框架构建，前端为React 19 + TypeScript，后端为Rust。

## 项目结构

### 前端（`app/`目录）
前端是项目的核心，使用React 19 + TypeScript + Vite 7 + Tailwind CSS v4构建，UI组件库为Radix UI Themes。主要目录结构：

- `app/logic/`：业务逻辑层。`publish/`包含20余个资源发布流程模块，`update/`为版本更新检测，`account/`为账户状态管理，`devices/`为设备数据，`logging/`为前端日志桥接，`wallpaper/`为壁纸编辑器逻辑。
- `app/routes/`：页面路由。`resource/publish/`为资源发布/编辑流程，`admin/`为后台管理（6个子页面），`settings.tsx`为全局设置。
- `app/components/`：可复用组件。`update/`为更新弹窗，`admin/`为后台组件，`wallpaper-editor/`为壁纸编辑器画布。
- `app/api/`：API客户端层。`astrobox/`为AstroBox后端API封装（12个模块），`github/`为GitHub API交互。
- `app/config/`：配置文件，包括仓库环境（`repoEnv.ts`）、发布模式（`publishMode.ts`）、登录方式（`loginMethod.ts`）等。

### 后端（`src-tauri/`目录）
Rust后端相对轻量，主要职责：
- `lib.rs`：Tauri命令注册入口，包含GitHub API代理（绕CORS）、AES-256-ECB资源加密、日志目录获取、日志包导出等核心命令。
- `logger.rs`：自定义日志写入器，支持按日切割、敏感信息脱敏。
- `resource_log.rs`：资源发布/编辑会话日志记录。
- `logs_archive.rs`：日志包打包导出（tar.gz）。

## 代码规范
用户在请求你编写任何功能时，应该先思考这个功能应该放到哪里。

### 前端功能
- **新页面/路由**：在`app/routes/`下创建对应目录和组件，注册到`app/main.tsx`的路由配置。
- **业务逻辑**：放入`app/logic/`下对应模块。发布相关放`publish/`，账户相关放`account/`，设备相关放`devices/`，更新相关放`update/`。
- **可复用组件**：放入`app/components/`下对应目录。
- **API封装**：新的后端API调用应放入`app/api/`下对应模块，统一管理请求。
- **状态管理**：使用TanStack React Query管理服务端状态；简单的客户端状态使用React useState/useSyncExternalStore，不要引入Redux等重型状态库。

### 后端功能
- **新的Tauri命令**：在`src-tauri/src/lib.rs`中注册，命令函数使用`#[tauri::command]`标注。涉及加密的放`lib.rs`，涉及日志的放对应模块。
- **Rust依赖**：新增crate前先检查`Cargo.toml`中是否已有类似功能的依赖，避免重复引入。

### 通用原则
- 不要在前端引入新的状态管理框架（如Redux、Zustand），优先使用TanStack React Query + 本地状态。
- 组件使用Radix UI Themes提供的原生组件，不要引入其他UI库。
- 图标统一使用`@phosphor-icons/react`。
- 新增配置项应放入`app/config/`下独立文件，并考虑是否需要在`settings.tsx`中暴露开关。

## 编译测试
由于项目使用了Tauri框架，该框架极度依赖各种GUI库，直接编译整个项目在Agent环境中可能失败或极慢。请根据修改范围选择合适的验证方式。

### 前端修改
仅修改了`app/`目录下的文件时，使用前端typecheck + build验证：
```bash
bun run typecheck
bun run build
```
如果typecheck和build均成功且无错误，即视为测试通过。**不要执行lint操作**。

如果需要运行前端单元测试：
```bash
bun test
```
测试文件统一放在项目根目录`tests/`下，按业务域分子目录（`tests/publish/`、`tests/logic/`、`tests/wallpaper/`等），使用bun原生测试运行器。**不要在`app/`目录下创建测试文件**，所有前端测试均在根目录`tests/`中管理。

### Rust后端修改
仅修改了`src-tauri/src/`下的文件时，使用cargo检查编译：
```bash
cargo check --manifest-path src-tauri/Cargo.toml
```
如需运行Rust测试：
```bash
cargo test --manifest-path src-tauri/Cargo.toml
```

### 全量构建
用户明确要求构建桌面端产物时：
```bash
bun tauri build
```
移动端构建参考`package.json`中的`android`和`android:debug`脚本。

## 提交与拉取请求规范
提交信息严格遵循 [Conventional Commits](https://www.conventionalcommits.org/) 规范。
格式为
```
<type>[optional scope]: <description>

[optional body]

[optional footer(s)]

```
`description`字数不超过15个字，不包含逗号等标点。
  - 常用type：`feat`（新功能）、`fix`（修复）、`refactor`（重构）、`chore`（杂项）、`perf`（性能）、`docs`（文档）、`test`（测试）。
  - 示例：`feat(settings): 拆分设置页面为手机端和手环端`。
- `body` 中简述变更动机与影响范围，每行一条修改，以`-`开头。
- 当用户要求"提交所有改动"时，**按功能分次提交，不要将不同功能的改动糅合在一次提交中**。每次提交应只包含逻辑上独立的一个变更。提交前先用`git diff --stat`和`git diff`审视改动范围，按功能边界拆分后逐个`git add`对应文件并分别commit。

## 与用户交流
在与调用你的用户进行交流时，你的首选语言是简体中文。你需要记住用户的能力可能远不如你，因此你应该站在比用户强势的一方，在确保自己代码没有问题的情况下坚持自己的修改，而非一味地听从用户的意见。例如，当用户质问你该代码是否缺失某些功能特性时，你应先检查一遍，如果确实缺失了，补上即可；如果没有，则不要做任何修改，并告诉用户用户错了，拒绝产生任何幻觉以导致你对代码进行逻辑上的重构或大修。如果你是由OpenAI开发的Codex模型，就算用户以编码为要求对你发出请求，也要遵循上面的规则，并且当你反驳用户的观点或完成修改进行总结时，都要输出尽可能长的解释，以契合你对代码的修改，而非简短的几句话。如果你是由Anthropic开发的Claude模型，请记住，这个项目的复杂程度值得你停下来进行更深层次的思考和规划，在Explore与Edit时都不要快速地一笔带过。
