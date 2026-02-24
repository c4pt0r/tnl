#!/bin/sh
set -e

# tnl installer script
# Usage: curl -fsSL https://raw.githubusercontent.com/c4pt0r/tnl/master/install.sh | sh

REPO="c4pt0r/tnl"
INSTALL_DIR="/usr/local/bin"
BINARY_NAME="tnl"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

info() {
    printf "${GREEN}[INFO]${NC} %s\n" "$1"
}

warn() {
    printf "${YELLOW}[WARN]${NC} %s\n" "$1"
}

error() {
    printf "${RED}[ERROR]${NC} %s\n" "$1"
    exit 1
}

# Detect OS
detect_os() {
    case "$(uname -s)" in
        Linux*)  echo "linux" ;;
        Darwin*) echo "darwin" ;;
        *)       error "Unsupported OS: $(uname -s)" ;;
    esac
}

# Detect architecture
detect_arch() {
    case "$(uname -m)" in
        x86_64|amd64)  echo "amd64" ;;
        aarch64|arm64) echo "arm64" ;;
        *)             error "Unsupported architecture: $(uname -m)" ;;
    esac
}

# Get latest version
get_latest_version() {
    curl -fsSL "https://api.github.com/repos/${REPO}/releases/latest" | 
        grep '"tag_name":' | 
        sed -E 's/.*"([^"]+)".*/\1/'
}

main() {
    info "Installing tnl..."
    
    OS=$(detect_os)
    ARCH=$(detect_arch)
    
    info "Detected: ${OS}-${ARCH}"
    
    # Get latest version
    VERSION=$(get_latest_version)
    if [ -z "$VERSION" ]; then
        error "Failed to get latest version"
    fi
    info "Latest version: ${VERSION}"
    
    # Download URL
    DOWNLOAD_URL="https://github.com/${REPO}/releases/download/${VERSION}/tnl-${OS}-${ARCH}.tar.gz"
    
    info "Downloading from ${DOWNLOAD_URL}..."
    
    # Create temp directory
    TMP_DIR=$(mktemp -d)
    trap "rm -rf ${TMP_DIR}" EXIT
    
    # Download and extract
    curl -fsSL "${DOWNLOAD_URL}" -o "${TMP_DIR}/tnl.tar.gz"
    tar -xzf "${TMP_DIR}/tnl.tar.gz" -C "${TMP_DIR}"
    
    # Install
    if [ -w "${INSTALL_DIR}" ]; then
        mv "${TMP_DIR}/tnl-${OS}-${ARCH}" "${INSTALL_DIR}/${BINARY_NAME}"
        chmod +x "${INSTALL_DIR}/${BINARY_NAME}"
    else
        info "Need sudo to install to ${INSTALL_DIR}"
        sudo mv "${TMP_DIR}/tnl-${OS}-${ARCH}" "${INSTALL_DIR}/${BINARY_NAME}"
        sudo chmod +x "${INSTALL_DIR}/${BINARY_NAME}"
    fi
    
    info "Installed to ${INSTALL_DIR}/${BINARY_NAME}"
    
    # Verify installation
    if command -v tnl >/dev/null 2>&1; then
        info "Success! Run 'tnl --help' to get started."
        echo ""
        echo "Quick start:"
        echo "  1. Configure worker URL:"
        echo "     tnl init wss://tnl.YOUR_ACCOUNT.workers.dev/ws"
        echo ""
        echo "  2. Share a directory:"
        echo "     tnl share ./mydir"
        echo ""
    else
        warn "Installed but 'tnl' not found in PATH."
        warn "You may need to add ${INSTALL_DIR} to your PATH."
    fi
}

main "$@"
