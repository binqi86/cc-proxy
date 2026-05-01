#!/bin/bash
# Codex CN Proxy App - 开发环境搭建脚本
set -e

echo "Codex CN Proxy App - Setup"
echo "=========================="
echo ""

# Node.js
echo "Checking Node.js..."
if ! command -v node &> /dev/null; then
    echo "Node.js is required. Install from: https://nodejs.org/"
    exit 1
fi
echo "  Node.js $(node --version)"

# npm
echo "Checking npm..."
if ! command -v npm &> /dev/null; then
    echo "npm is required."
    exit 1
fi
echo "  npm $(npm --version)"

# Rust
echo "Checking Rust..."
if ! command -v cargo &> /dev/null; then
    echo "Rust is required. Install from: https://rustup.rs/"
    exit 1
fi
echo "  $(rustc --version)"
echo "  $(cargo --version)"

# Install deps
echo ""
echo "Installing npm dependencies..."
npm install

# Config reminder
echo ""
echo "Config files:"
echo "  providers.example.json -> copy to providers.json for local dev"
echo "  providers.json         -> user config (gitignored, contains API keys)"
echo "  .env                   -> create in project root (dev) or ~/.codex-cn-proxy/ (production)"
echo ""

# Auto-copy providers.example.json if providers.json doesn't exist
if [ ! -f "providers.json" ]; then
    if [ -f "providers.example.json" ]; then
        cp providers.example.json providers.json
        echo "Copied providers.example.json -> providers.json (edit API keys before use)"
        echo ""
    fi
fi
echo "Setup complete."
echo ""
echo "Next steps:"
echo "  1. Edit .env and set TARGET_API_KEY=sk-your-key"
echo "  2. Run: npm run tauri dev"
echo ""
echo "To build macOS app:"
echo "  npm run tauri build"
