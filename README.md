# Codex CN Proxy

将 Codex CLI / Desktop 的 OpenAI Responses API 转换为国内大模型 Chat Completions API 的本地代理工具。macOS 菜单栏应用，一键启停，无 Dock 占用。

## 功能

- **菜单栏托盘** — ∞ 图标常驻菜单栏，一级菜单直接启停代理
- **无 Dock 图标** — 纯菜单栏应用，关闭窗口即隐藏，不占 Dock 空间
- **Provider 管理** — 内置 DeepSeek、阿里百炼、智谱、Moonshot 等 6 个国内大模型配置
- **模型映射** — 自动将 gpt-5、gpt-5-codex 等模型名映射为国内模型
- **环境配置** — GUI 编辑 .env，支持实时保存
- **调试日志** — 显示 `原模型 → 目标模型` 映射链路，方便排查
- **测试工具** — 内置请求测试，验证配置是否正确

## 技术栈

- **桌面框架**：Tauri 2
- **前端**：React 18 + TypeScript + Tailwind CSS
- **状态管理**：Zustand
- **构建**：Vite
- **代理服务**：Node.js (CommonJS)

## 环境要求

- Node.js 18+
- Rust 1.70+
- macOS 12+

## 快速开始

```bash
git clone https://github.com/your-username/codex-cn-proxy-app.git
cd codex-cn-proxy-app
npm install
```

### 配置

应用启动后会自动创建 `~/.codex-cn-proxy/` 目录并复制初始文件。编辑 `~/.codex-cn-proxy/.env`：

```bash
PROVIDER_PRESET=deepseek
TARGET_API_KEY=sk-your-api-key
```

也可通过应用内「环境配置」标签页可视化编辑。

### 开发

```bash
npm run tauri dev
```

### 构建

```bash
npm run tauri build
```

构建产物：
- `.app`：`src-tauri/target/release/bundle/macos/Codex CN Proxy.app`
- `.dmg`：`src-tauri/target/release/bundle/dmg/Codex CN Proxy_1.0.0_aarch64.dmg`

> DMG 创建需要 `hdiutil`，sandbox 环境需手动执行：`hdiutil create -srcfolder "Codex CN Proxy.app" -format UDZO -o output.dmg`

## 使用方式

| 操作 | 方式 |
|------|------|
| 启动代理 | 点击菜单栏 ∞ 图标 → Start Proxy |
| 停止代理 | 点击菜单栏 ∞ 图标 → Stop Proxy |
| 打开配置 | 点击菜单栏 ∞ 图标 → Show Settings |
| 退出应用 | 点击菜单栏 ∞ 图标 → Quit |
| 关闭窗口 | 窗口隐藏到后台，不退出 |

## 项目结构

```
codex-cn-proxy-app/
├── src/                    # React 前端
│   ├── components/         # UI 组件 (ProviderTab, EnvConfig, StatusMonitor, TestTool)
│   ├── lib/                # 类型、API 封装、工具函数
│   ├── store/              # Zustand 状态管理
│   ├── App.tsx             # 主布局
│   └── main.tsx            # React 入口
├── src-tauri/              # Tauri Rust 后端
│   ├── src/
│   │   ├── lib.rs          # 托盘、命令、状态同步
│   │   ├── process.rs      # Node.js 进程管理
│   │   └── config.rs       # 配置文件读写
│   ├── resources/          # 打包进 app bundle 的资源
│   │   ├── providers.json  # Provider 预设配置
│   │   └── server.cjs      # Node.js 代理服务
│   ├── icons/              # 应用图标和托盘图标
│   ├── Cargo.toml
│   └── tauri.conf.json
├── server.cjs              # Node.js 代理服务（开发用）
├── package.json
└── vite.config.ts
```

## 内置 Provider

- **DeepSeek** — `https://api.deepseek.com`
- **阿里云百炼 (Dashscope)** — `https://dashscope.aliyuncs.com/compatible-mode`
- **智谱 GLM (Zhipu)** — `https://open.bigmodel.cn/api/paas`
- **Moonshot (Kimi)** — `https://api.moonshot.cn`
- **MiniMax** — `https://api.minimax.io`
- **火山方舟 Coding (Volcengine)** — `https://ark.cn-beijing.volces.com/api/coding/v3`

## 配置文件位置

| 模式 | 位置 |
|------|------|
| 开发 (`tauri dev`) | 项目根目录 |
| 生产 (`.app`) | `~/.codex-cn-proxy/`，首次启动自动创建并复制 |

## 故障排除

### 无法启动服务

1. 确认 Node.js 已安装：`node --version`
2. 检查 `~/.codex-cn-proxy/.env` 中 `TARGET_API_KEY` 已配置
3. 查看应用日志（Show Settings → 状态监控）

### 托盘图标看不见

检查菜单栏是否有 `∞` 图标。macOS 菜单栏拥挤时可能被隐藏，可按住 `⌘` 拖动调整位置。

### 应用无法打开

macOS 可能阻止未签名应用。在终端执行：
```bash
xattr -cr "/Applications/Codex CN Proxy.app"
```

## Windows 支持

项目基于 Tauri 2 跨平台框架构建，Windows 适配需要：
- 托盘图标（`.ico` 格式）
- 配置目录改为 `%APPDATA%\codex-cn-proxy\`
- 打包格式改为 `.msi`
- 去除 macOS 专属 API（`LSUIElement`、`set_activation_policy`）

## 许可证

MIT License
