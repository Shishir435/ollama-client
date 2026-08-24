#!/usr/bin/env sh
set -eu

repo="Shishir435/ollama-client"
install_dir="${OLC_INSTALL_DIR:-$HOME/.local/share/olc}"
bin_dir="${OLC_BIN_DIR:-$HOME/.local/bin}"
version="${OLC_VERSION:-latest}"

fail() {
  printf 'olc installer: %s\n' "$1" >&2
  exit 1
}

command -v node >/dev/null 2>&1 || fail "Node.js 22.12 or newer is required: https://nodejs.org/"
node -e 'const [major, minor] = process.versions.node.split(".").map(Number); process.exit(major > 22 || (major === 22 && minor >= 12) ? 0 : 1)' || fail "Node.js 22.12 or newer is required"

if command -v curl >/dev/null 2>&1; then
  fetch() { curl --fail --silent --show-error --location "$1" --output "$2"; }
elif command -v wget >/dev/null 2>&1; then
  fetch() { wget --quiet "$1" --output-document "$2"; }
else
  fail "curl or wget is required"
fi

if [ -n "${OLC_DOWNLOAD_BASE_URL:-}" ]; then
  base_url=${OLC_DOWNLOAD_BASE_URL%/}
else
  case "$version" in
    latest) base_url="https://github.com/$repo/releases/latest/download" ;;
    *) base_url="https://github.com/$repo/releases/download/$version" ;;
  esac
fi

temp_dir=$(mktemp -d "${TMPDIR:-/tmp}/olc-install.XXXXXX")
trap 'rm -rf "$temp_dir"' EXIT HUP INT TERM
archive="$temp_dir/olc.tar.gz"
checksum="$temp_dir/olc.tar.gz.sha256"

printf 'Downloading olc (%s)...\n' "$version"
fetch "$base_url/olc.tar.gz" "$archive"
fetch "$base_url/olc.tar.gz.sha256" "$checksum"

expected=$(awk '{print $1; exit}' "$checksum")
if command -v sha256sum >/dev/null 2>&1; then
  actual=$(sha256sum "$archive" | awk '{print $1}')
elif command -v shasum >/dev/null 2>&1; then
  actual=$(shasum -a 256 "$archive" | awk '{print $1}')
else
  fail "sha256sum or shasum is required to verify the download"
fi
[ "$actual" = "$expected" ] || fail "checksum verification failed"

tar -xzf "$archive" -C "$temp_dir"
[ -f "$temp_dir/olc/dist/olc.mjs" ] || fail "release archive is missing olc.mjs"

parent_dir=$(dirname "$install_dir")
stage_dir="$parent_dir/.olc-install-$$"
backup_dir="$parent_dir/.olc-backup-$$"
mkdir -p "$parent_dir" "$bin_dir"
mv "$temp_dir/olc" "$stage_dir"
if [ -e "$install_dir" ]; then
  mv "$install_dir" "$backup_dir"
fi
if ! mv "$stage_dir" "$install_dir"; then
  [ ! -e "$backup_dir" ] || mv "$backup_dir" "$install_dir"
  fail "could not install into $install_dir"
fi
rm -rf "$backup_dir"
ln -sfn "$install_dir/bin/olc" "$bin_dir/olc"

printf 'Installed olc in %s\n' "$install_dir"
case ":$PATH:" in
  *":$bin_dir:"*) printf 'Run: olc --help\n' ;;
  *) printf 'Add %s to PATH, then run: olc --help\n' "$bin_dir" ;;
esac
