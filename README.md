# Codex CN Proxy - Mac 客户端应用

将 Codex CLI / Desktop 新版使用的 OpenAI Responses API 转换成国内大模型的 Chat Completions API 的本地代理工具的可视化管理界面。

## 功能

- 🎛️ **一键启动/停止代理服务** - 无需命令行，轻松管理 Node.js 代理服务
- 🤖️ **Provider 配置管理** - 通过选项卡快速配置不同的国内大模型（DeepSeek、Kimi、智谱等）
- ⚙️ **环境配置可视化** - 直接在 GUI 中编辑 .env 配置，支持实时验证
- 📊 **状态监控** - 实时查看服务运行状态、请求数量和日志
- 🧪 **内置测试工具** - 发送测试请求，验证配置是否正确

## 技术栈

- **桌面框架：** Tauri 2.0
- **前端框架：** React 18 + TypeScript
- **UI 组件库：** shadcn/ui
- **样式方案：** Tailwind CSS
- **状态管理：** Zustand
- **图标库：** Lucide React
- **构建工具：** Vite

## 环境要求

### 必需
- Node.js 18.17+ (用于运行代理服务）
- Rust 1.70+ (用于编译 Tauri 后端）
- npm 9+ 或 yarn 1.22+
- macOS 12+ (Darwin Monterey 或更高版本）

### 可选
- Tauri CLI（通过 npm 自动安装）

## 快速开始

### 1. 克隆项目

```bash
git clone https://github.com/your-username/codex-cn-proxy-app.git
cd codex-cn-proxy-app
```

### 2. 安装依赖

```bash
npm install
```

### 3. 准备配置

在项目根目录创建 `server.js` 和配置文件：

```bash
# 从原项目复制或创建
cp ../server.js .
cp ../providers.json .
cp .env.example .env
```

编辑 `.env` 文件，至少配置：

```bash
PROVIDER_PRESET=deepseek
TARGET_API_KEY=sk-your-provider-key
```

### 4. 启动开发环境

```bash
npm run tauri dev
```

这将同时启动：
- Tauri 开发服务器（热重载）
- Vite 前端开发服务器（热重载）

### 5. 构建 macOS 应用

```bash
npm run tauri build
```

构建产物位于 `src-tauri/target/release/bundle/dmg/` 目录。

## 使用指南

### 配置 Provider

1. 打开应用，点击 "Providers" 标签页
2. 从左侧列表选择一个内置 Provider（DeepSeek、Moonshot 等）
3. 或点击 "+ 自定义 Provider" 添加新的配置
4. 编辑右侧表单中的参数：
   - Base URL
   - Chat Path
   - Models Path
   - Default Model
   - Model Map（将 Codex 模型名映射到上游模型名）
5. 点击 "保存配置"

### 配置环境变量

1. 点击 "环境配置" 标签页
2. 配置以下参数：
   - **Host / Port** - 本地服务地址
   - **Proxy API Key** - 可选的本地代理鉴权
   - **Provider Preset** - 选择上游 Provider
   - **Target API Key** - 必填，上游服务的 API Key
   - **Default Model** - 默认使用的模型
   - **Request Timeout** - 请求超时时间（毫秒）
   - **Log Upstream Request** - 是否记录上游请求摘要
   - **MODEL_MAP** - 高级的模型名映射（JSON 格式）
3. 点击 "保存并重启服务"

### 监控服务状态

1. 点击 "状态监控" 标签页
2. 查看服务运行状态（运行中/已停止）
3. 查看请求数量和平均延迟
4. 实时查看日志，按颜色区分：
   - 🟢 绿色：成功
   - 🔴 红色：错误
   - 🟡 橙色：警告
   - ⚪ 灰色：信息

### 测试连接

1. 点击 "测试工具" 标签页
2. 配置测试请求：
   - Model：要测试的模型名
   - Stream：是否使用流式响应
   - Message：测试消息
3. 点击 "发送测试请求"
4. 查看响应结果：
   - HTTP 状态码
   - 响应延迟
   - Token 使用量
   - 响应内容

## 项目结构

```
codex-cn-proxy-app/
├── src/                    # React 前端
│   ├── components/
│   │   ├── ui/           # shadcn/ui 基础组件
│   │   ├── ProviderTab.tsx
│   │   ├── EnvConfig.tsx
│   │   ├── StatusMonitor.tsx
│   │   └── TestTool.tsx
│   ├── lib/
│   │   ├── config.ts      # 类型定义
│   │   ├── api.ts         # Tauri API 封装
│   │   └── utils.ts       # 工具函数
│   ├── store/
│   │   └── appStore.ts   # Zustand 状态管理
│   ├── App.tsx
│   ├── main.tsx
│   └── index.css
├── src-tauri/             # Tauri Rust 后端
│   ├── src/
│   │   ├── lib.rs         # Tauri 命令入口
│   │   ├── process.rs     # Node.js 进程管理
│   │   └── config.rs      # 配置文件读写
│   ├── Cargo.toml
│   └── tauri.conf.json
├── server.js              # Node.js 代理服务（从原项目复制）
├── providers.json         # Provider 配置（从原项目复制）
├── .env                  # 环境变量（从 .env.example 复制）
├── package.json
├── tsconfig.json
└── vite.config.ts
```

## 内置 Provider

应用内置了以下国内大模型的配置：

- **DeepSeek** - https://api.deepseek.com
- **Moonshot (Kimi)** - https://api.moonshot.cn
- **智谱 GLM (Zhipu)** - https://open.bigmodel.cn/api/paas
- **通义千问 (Dashscope)** - https://dashscope.aliyuncs.com/compatible-mode
- **MiniMax** - https://api.minimax.io
- **火山方舟 Coding (Volcengine)** - https://ark.cn-beijing.volces.com/api/coding/v3

每个配置都预设了合理的默认参数，包括模型名映射。

## 开发

### 添加新的 UI 组件

使用 shadcn/ui 风格创建新组件：

```bash
npx shadcn-ui@latest add [component-name]
```

### Tauri 命令

在 `src-tauri/src/lib.rs` 中添加新的 Tauri 命令：

```rust
#[tauri::command]
async fn my_command(param: String) -> Result<String, String> {
    Ok(format!("Received: {}", param))
}
```

然后在 Rust 中注册命令：

```rust
.invoke_handler(tauri::generate_handler![
    my_command,
    // ... 其他命令
])
```

在前端调用：

```typescript
import { invoke } from '@tauri-apps/api/core';
const result = await invoke<string>('my_command', { param: 'value' });
```

## 故障排除

### Tauri 构建失败

确保已安装 Rust 工具链：

```bash
rustc --version
cargo --version
```

如果缺少 Rust，从 https://rustup.rs/ 安装。

### 无法启动服务

1. 检查 Node.js 是否正确安装：`node --version`
2. 检查 `server.js` 是否存在于项目目录
3. 检查 `.env` 配置是否正确，特别是 `TARGET_API_KEY`
4. 查看状态监控中的日志获取详细错误信息

### 配置保存失败

1. 检查文件权限
2. 确保 `providers.json` 和 `.env` 文件格式正确
3. 尝试手动编辑这些文件然后重启应用

## 许可证

MIT License - 见 LICENSE 文件

## 贡献

欢迎提交 Issue 和 Pull Request！

## 相关项目

- [codex-cn-proxy](https://github.com/your-username/codex-cn-proxy) - 原始命令行代理工具
- [Tauri](https://tauri.app/) - 桌面应用框架
- [shadcn/ui](https://ui.shadcn.com/) - UI 组件库
