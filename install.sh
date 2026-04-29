#!/bin/sh
# resumelang installer
# Usage: curl -sSfL https://raw.githubusercontent.com/ovsec/resumelang/main/install.sh | sh

set -e

REPO="ovsec/resumelang"
BIN="resumelang"
INSTALL_DIR="${INSTALL_DIR:-/usr/local/bin}"

# Detect OS
OS="$(uname -s)"
case "$OS" in
  Linux*)  OS=linux ;;
  Darwin*) OS=darwin ;;
  *)       echo "Unsupported OS: $OS" >&2; exit 1 ;;
esac

# Detect arch
ARCH="$(uname -m)"
case "$ARCH" in
  x86_64|amd64) ARCH=amd64 ;;
  arm64|aarch64) ARCH=arm64 ;;
  *) echo "Unsupported arch: $ARCH" >&2; exit 1 ;;
esac

# Get latest version from GitHub API
VERSION="$(curl -sSf "https://api.github.com/repos/${REPO}/releases/latest" \
  | grep '"tag_name"' | sed -E 's/.*"tag_name": *"([^"]+)".*/\1/')"

if [ -z "$VERSION" ]; then
  echo "Could not determine latest version." >&2
  exit 1
fi

TARBALL="${BIN}_${VERSION#v}_${OS}_${ARCH}.tar.gz"
URL="https://github.com/${REPO}/releases/download/${VERSION}/${TARBALL}"

echo "Installing resumelang ${VERSION} (${OS}/${ARCH})..."

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

curl -sSfL "$URL" -o "$TMP/$TARBALL"
tar -xzf "$TMP/$TARBALL" -C "$TMP"

if [ ! -w "$INSTALL_DIR" ]; then
  echo "Needs sudo to write to $INSTALL_DIR"
  sudo mv "$TMP/$BIN" "$INSTALL_DIR/$BIN"
  sudo chmod +x "$INSTALL_DIR/$BIN"
else
  mv "$TMP/$BIN" "$INSTALL_DIR/$BIN"
  chmod +x "$INSTALL_DIR/$BIN"
fi

echo "Installed: $($INSTALL_DIR/$BIN version)"
echo ""
echo "  resumelang init          # scaffold resume.yml"
echo "  resumelang build         # compile to dist/"
echo "  resumelang serve         # open editor at http://localhost:3000"
