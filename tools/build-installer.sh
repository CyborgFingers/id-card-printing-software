#!/usr/bin/env bash
# ID Card Printing Software Free - Copyright (c) 2026 Josh McNabb. All rights reserved.
#
# Builds the Windows installer from a Mac:  dist/ID-Card-Printing-Software-Free-Setup-<version>.exe
# Publishes the app and downloads the bundled runtimes here, copies everything to a Windows
# machine over SSH, compiles the setup there with Inno Setup 6 (tools/build-installer.ps1) and
# copies it back.
#   ./tools/build-installer.sh user@windows-pc [folder-on-windows]     (default C:/build-installer)
# The Windows machine needs OpenSSH Server, Inno Setup 6 and internet access (it checks the
# downloads again: SHA-512 from Microsoft's releases.json, Microsoft signatures). Put any SSH
# options (key, port) in ~/.ssh/config. Needs the .NET 10 SDK (dotnet, or ~/.dotnet/dotnet).
set -euo pipefail

TARGET="${1:?Usage: $0 user@windows-pc [folder-on-windows]}"
REMOTE="${2:-C:/build-installer}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DOTNET="$(command -v dotnet || echo "$HOME/.dotnet/dotnet")"
DOTNET_VERSION="$(sed -n "s/^\$DotnetVersion = '\([^']*\)'.*/\1/p" "$ROOT/tools/build-installer.ps1")"
VERSION="$(sed -n 's:.*<Version>\(.*\)</Version>.*:\1:p' "$ROOT/desktop/Directory.Build.props")"
SETUP="ID-Card-Printing-Software-Free-Setup-$VERSION.exe"
REDIST="$ROOT/installer/redist"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# Runs PowerShell on the Windows machine (encoded, so cmd or PowerShell as the SSH shell both work).
remote_ps() {
  local script="\$ErrorActionPreference = 'Stop'; \$ProgressPreference = 'SilentlyContinue'; $1"
  ssh "$TARGET" "powershell -NoProfile -ExecutionPolicy Bypass -EncodedCommand $(printf '%s' "$script" | iconv -f UTF-8 -t UTF-16LE | base64 | tr -d '\n')"
}

sha512() { shasum -a 512 "$1" | cut -d' ' -f1; }

echo "Building $SETUP (.NET runtimes $DOTNET_VERSION)"

# 1. The app (framework-dependent, 64-bit Windows)
rm -rf "$ROOT/build/publish"
"$DOTNET" publish "$ROOT/desktop/src/IdCard.Desktop/IdCard.Desktop.csproj" -c Release -r win-x64 \
  --self-contained false -p:EnableWindowsTargeting=true -o "$ROOT/build/publish"

# 2. .NET runtimes, checked against the SHA-512 in Microsoft's releases.json (cached in installer/redist)
mkdir -p "$REDIST"
curl -fsSL https://builds.dotnet.microsoft.com/dotnet/release-metadata/10.0/releases.json -o "$WORK/releases.json"
python3 -I - "$WORK/releases.json" "$DOTNET_VERSION" > "$WORK/runtimes.txt" <<'PY'
import json, sys
release = next(r for r in json.load(open(sys.argv[1]))["releases"] if r["release-version"] == sys.argv[2])
for part, name in (("windowsdesktop", "windowsdesktop-runtime-win-x64.exe"),
                   ("aspnetcore-runtime", "aspnetcore-runtime-win-x64.exe")):
    f = next(f for f in release[part]["files"] if f["name"] == name)
    print(f["url"], f["hash"])
PY
while read -r url hash; do
  file="$REDIST/${url##*/}"
  if [[ -f "$file" && "$(sha512 "$file")" == "$hash" ]]; then echo "Cached: ${url##*/}"; continue; fi
  echo "Downloading $url"
  curl -fL --progress-bar "$url" -o "$file.part"
  [[ "$(sha512 "$file.part")" == "$hash" ]] || { rm -f "$file.part"; echo "SHA-512 mismatch: $url" >&2; exit 1; }
  mv "$file.part" "$file"
done < "$WORK/runtimes.txt"

# 3. WebView2 Runtime bootstrapper (no published hash; its signature is checked on Windows)
if [[ ! -f "$REDIST/MicrosoftEdgeWebview2Setup.exe" ]]; then
  echo "Downloading the WebView2 Runtime bootstrapper"
  curl -fL --progress-bar 'https://go.microsoft.com/fwlink/p/?LinkId=2124703' -o "$REDIST/MicrosoftEdgeWebview2Setup.exe.part"
  mv "$REDIST/MicrosoftEdgeWebview2Setup.exe.part" "$REDIST/MicrosoftEdgeWebview2Setup.exe"
fi

# 4. Copy what the Windows build needs, in the repo's layout
S="$WORK/src"
mkdir -p "$S/installer/redist" "$S/tools" "$S/legal" "$S/web/img" "$S/desktop" "$S/build"
cp "$ROOT/installer/setup.iss" "$S/installer/"
cp -R "$ROOT/installer/images" "$S/installer/"
cp "$REDIST/windowsdesktop-runtime-$DOTNET_VERSION-win-x64.exe" "$REDIST/aspnetcore-runtime-$DOTNET_VERSION-win-x64.exe" \
   "$REDIST/MicrosoftEdgeWebview2Setup.exe" "$S/installer/redist/"
cp "$ROOT/tools/build-installer.ps1" "$S/tools/"
cp "$ROOT/legal/"*.txt "$S/legal/"
cp "$ROOT/web/img/app.ico" "$S/web/img/"
cp "$ROOT/desktop/Directory.Build.props" "$S/desktop/"
cp -R "$ROOT/build/publish" "$S/build/publish"

echo "Copying to $TARGET:$REMOTE"
remote_ps "New-Item -ItemType Directory -Force '$REMOTE' | Out-Null
'$REMOTE/build/publish', '$REMOTE/dist/$SETUP' | Where-Object { Test-Path \$_ } | Remove-Item -Recurse -Force"
scp -rq "$S"/* "$TARGET:$REMOTE/"

# 5. Compile there and fetch the setup
ssh "$TARGET" "powershell -NoProfile -ExecutionPolicy Bypass -File \"$REMOTE/tools/build-installer.ps1\" -PublishDir \"$REMOTE/build/publish\""
mkdir -p "$ROOT/dist"
scp -q "$TARGET:$REMOTE/dist/$SETUP" "$ROOT/dist/"
echo "Built dist/$SETUP"
