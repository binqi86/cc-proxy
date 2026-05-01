#!/bin/bash

# Codex CN Proxy App Setup Script
# 此脚本帮助设置开发环境

set -e

echo "🚀 Codex CN Proxy App - Setup Script"
echo "====================================="
echo ""

# 检查 Node.js
echo "📦 检查 Node.js..."
if ! command -v node &> /dev/null; then
    echo "❌ Node.js 未安装，请先安装 Node.js 18.17+"
    echo "   访问: https://nodejs.org/"
    exit 1
fi
NODE_VERSION=$(node --version)
echo "✅ Node.js 已安装: $NODE_VERSION"

# 检查 npm
echo "📦 检查 npm..."
if ! command -v npm &> /dev/null; then
    echo "❌ npm 未安装"
    exit 1
fi
NPM_VERSION=$(npm --version)
echo "✅ npm 已安装: $NPM_VERSION"

# 检查 Rust
echo "🦀 检查 Rust..."
if ! command -v cargo &> /dev/null; then
    echo "⚠️  Rust 未安装，Tauri 需要 Rust"
    echo "   请访问: https://rustup.rs/ 安装 Rust"
    echo "   或运行: curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh"
    exit 1
fi
RUST_VERSION=$(rustc --version)
CARGO_VERSION=$(cargo --version)
echo "✅ Rust 已安装: $RUST_VERSION, $CARGO_VERSION"

# 安装 npm 依赖
echo ""
echo "📥 安装 npm 依赖..."
npm install

# 检查配置文件
echo ""
echo "📄 检查配置文件..."

if [ ! -f "server.js" ]; then
    echo "⚠️  server.js 不存在，请从原项目复制"
    echo "   cp ../server.js ."
fi

if [ ! -f "providers.json" ]; then
    echo "⚠️  providers.json 不存在，请从原项目复制"
    echo "   cp ../providers.json ."
fi

if [ ! -f ".env" ]; then
    echo "⚠️  .env 不存在"
    if [ -f ".env.example" ]; then
        echo "   从 .env.example 创建 .env..."
        cp .env.example .env
        echo "✅ 已创建 .env，请编辑配置"
    fi
fi

# 创建图标占位符
echo ""
echo "🎨 创建图标占位符..."
mkdir -p src-tauri/icons
if [ ! -f "src-tauri/icons/icon.icns" ]; then
    echo "⚠️  请添加应用图标到 src-tauri/icons/ 目录"
fi

echo ""
echo "✅ Setup 完成！"
echo ""
echo "下一步："
echo "1. 编辑 .env 文件，配置 TARGET_API_KEY"
echo "2. 运行: npm run tauri dev"
echo ""
echo "如需构建 macOS 应用:"
echo "   npm run tauri build"
