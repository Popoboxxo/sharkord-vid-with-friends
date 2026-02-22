#!/bin/sh
# Download ffmpeg and yt-dlp Linux binaries for the Docker container.
# Run this script once before starting docker-compose.dev.yml.
#
# Usage: sh scripts/download-binaries.sh

set -e

BIN_DIR="$(dirname "$0")/../bin"
mkdir -p "$BIN_DIR"

echo "Downloading yt-dlp (Linux standalone binary)..."
curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux -o "$BIN_DIR/yt-dlp"
chmod +x "$BIN_DIR/yt-dlp"

echo "Downloading ffmpeg (Linux static)..."
curl -L https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz -o /tmp/ffmpeg.tar.xz
mkdir -p /tmp/ffmpeg-extract
tar -xf /tmp/ffmpeg.tar.xz -C /tmp/ffmpeg-extract --strip-components=1
cp /tmp/ffmpeg-extract/ffmpeg "$BIN_DIR/ffmpeg"
chmod +x "$BIN_DIR/ffmpeg"
rm -rf /tmp/ffmpeg.tar.xz /tmp/ffmpeg-extract

echo "Done! Binaries in $BIN_DIR:"
ls -la "$BIN_DIR"
