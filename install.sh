#!/bin/bash
# TNL Installer - Tunnel-based file sharing
# Usage: curl -fsSL https://raw.githubusercontent.com/c4pt0r/tnl/master/install.sh | bash

set -e

REPO="c4pt0r/tnl"
INSTALL_DIR="${TNL_INSTALL_DIR:-/usr/local/bin}"
CHANNEL="${TNL_CHANNEL:-nightly}"
NIGHTLY_TAG="nightly"

# Detect OS and architecture
OS=$(uname -s | tr '[:upper:]' '[:lower:]')
ARCH=$(uname -m)

case "$ARCH" in
  x86_64)  ARCH="amd64" ;;
  aarch64) ARCH="arm64" ;;
  arm64)   ARCH="arm64" ;;
  *)       echo "Unsupported architecture: $ARCH"; exit 1 ;;
esac

case "$OS" in
  linux)  SUFFIX="linux-$ARCH" ;;
  darwin) SUFFIX="darwin-$ARCH" ;;
  *)      echo "Unsupported OS: $OS"; exit 1 ;;
esac

if [ "$CHANNEL" = "stable" ]; then
  echo "Fetching latest stable release..."
  LATEST=$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" | grep '"tag_name"' | sed -E 's/.*\"([^\"]+)\".*/\1/')
else
  echo "Fetching latest nightly build..."
  LATEST="$NIGHTLY_TAG"
fi

if [ -z "$LATEST" ]; then
  echo "Failed to get release metadata. Trying to build from source..."
  
  # Fallback: build from source
  if ! command -v go &> /dev/null; then
    echo "Go is not installed. Please install Go 1.21+ or wait for a release."
    exit 1
  fi
  
  TMP_DIR=$(mktemp -d)
  cd "$TMP_DIR"
  git clone --depth 1 "https://github.com/$REPO.git" tnl
  cd tnl
  go build -ldflags="-s -w -X main.version=dev -X main.commit=$(git rev-parse --short HEAD) -X main.buildDate=$(date -u +%Y-%m-%dT%H:%M:%SZ)" -o tnl ./cmd/tnl
  
  if [ -w "$INSTALL_DIR" ]; then
    mv tnl "$INSTALL_DIR/tnl"
  else
    sudo mv tnl "$INSTALL_DIR/tnl"
  fi
  
  rm -rf "$TMP_DIR"
  echo "✓ tnl installed to $INSTALL_DIR/tnl (built from source)"
  exit 0
fi

DOWNLOAD_URL="https://github.com/$REPO/releases/download/$LATEST/tnl-$SUFFIX"

echo "Downloading tnl $LATEST for $OS/$ARCH..."
TMP_FILE=$(mktemp)
curl -fsSL "$DOWNLOAD_URL" -o "$TMP_FILE"
chmod +x "$TMP_FILE"

# Install
if [ -w "$INSTALL_DIR" ]; then
  mv "$TMP_FILE" "$INSTALL_DIR/tnl"
else
  sudo mv "$TMP_FILE" "$INSTALL_DIR/tnl"
fi

echo "✓ tnl $LATEST installed to $INSTALL_DIR/tnl"
echo ""
echo "Get started:"
echo "  tnl init wss://tnl.db9.workers.dev/ws"
echo "  tnl share ./myfile"
echo ""
echo "Installed channel: $CHANNEL"
