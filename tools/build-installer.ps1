# ID Card Printing Software Free - Copyright (c) 2026 Josh McNabb. All rights reserved.
#
# Builds the Windows installer: dist\ID-Card-Printing-Software-Free-Setup-<version>.exe
# Runs on Windows with Inno Setup 6 installed (https://jrsoftware.org/isdl.php).
#   .\tools\build-installer.ps1                        # dotnet publish the app, then build the setup
#   .\tools\build-installer.ps1 -PublishDir <folder>   # use an existing publish folder
# The .NET runtimes and the WebView2 bootstrapper are downloaded once into installer\redist
# (git-ignored). The runtimes are checked against the SHA-512 in Microsoft's releases.json, and
# all three must carry a valid Microsoft signature.
# The version comes from desktop\Directory.Build.props.
[CmdletBinding()]
param([string]$PublishDir)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'   # Invoke-WebRequest is very slow with its progress bar
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

$DotnetVersion = '10.0.13'   # bundled .NET runtimes; tools/build-installer.sh reads it from here
$Root = Split-Path $PSScriptRoot -Parent
$Redist = Join-Path $Root 'installer\redist'
$Version = (Select-Xml -Path (Join-Path $Root 'desktop\Directory.Build.props') -XPath '//Version').Node.InnerText
Write-Host "Building ID Card Printing Software Free $Version setup (.NET runtimes $DotnetVersion)"

# 1. The app (framework-dependent, 64-bit)
if (-not $PublishDir) {
  $PublishDir = Join-Path $Root 'build\publish'
  if (Test-Path $PublishDir) { Remove-Item $PublishDir -Recurse -Force }
  & dotnet publish (Join-Path $Root 'desktop\src\IdCard.Desktop\IdCard.Desktop.csproj') -c Release -r win-x64 --self-contained false -o $PublishDir
  if ($LASTEXITCODE) { throw "dotnet publish failed (exit code $LASTEXITCODE)" }
}
$PublishDir = (Get-Item -LiteralPath $PublishDir).FullName
if (-not (Test-Path -LiteralPath (Join-Path $PublishDir 'ID Card Printing Software.exe'))) {
  throw "$PublishDir has no 'ID Card Printing Software.exe'"
}

function Assert-MicrosoftSigned([string]$File) {
  $sig = Get-AuthenticodeSignature -LiteralPath $File
  if ($sig.Status -ne 'Valid' -or $sig.SignerCertificate.Subject -notmatch 'O=Microsoft Corporation') {
    throw "$File isn't validly signed by Microsoft ($($sig.Status)). Delete it and build again."
  }
}

# 2. .NET runtimes
New-Item -ItemType Directory -Force $Redist | Out-Null
$releases = Invoke-RestMethod 'https://builds.dotnet.microsoft.com/dotnet/release-metadata/10.0/releases.json'
$release = $releases.releases | Where-Object { $_.'release-version' -eq $DotnetVersion }
if (-not $release) { throw ".NET $DotnetVersion isn't in releases.json" }
$runtimes = @($release.windowsdesktop.files | Where-Object name -eq 'windowsdesktop-runtime-win-x64.exe') +
            @($release.'aspnetcore-runtime'.files | Where-Object name -eq 'aspnetcore-runtime-win-x64.exe')
if ($runtimes.Count -ne 2) { throw "Couldn't find both Windows x64 runtime installers for .NET $DotnetVersion" }
foreach ($runtime in $runtimes) {
  $file = Join-Path $Redist ([IO.Path]::GetFileName(([uri]$runtime.url).AbsolutePath))
  if ((Test-Path $file) -and (Get-FileHash $file -Algorithm SHA512).Hash -eq $runtime.hash) {
    Write-Host "Cached: $(Split-Path $file -Leaf)"
  } else {
    Write-Host "Downloading $($runtime.url)"
    Invoke-WebRequest $runtime.url -OutFile "$file.part" -UseBasicParsing
    if ((Get-FileHash "$file.part" -Algorithm SHA512).Hash -ne $runtime.hash) {
      Remove-Item "$file.part"
      throw "SHA-512 mismatch: $($runtime.url)"
    }
    Move-Item "$file.part" $file -Force
  }
  Assert-MicrosoftSigned $file
}

# 3. WebView2 Runtime bootstrapper (Evergreen; it downloads the runtime when it runs)
$webView2 = Join-Path $Redist 'MicrosoftEdgeWebview2Setup.exe'
if (-not (Test-Path $webView2)) {
  Write-Host 'Downloading the WebView2 Runtime bootstrapper'
  Invoke-WebRequest 'https://go.microsoft.com/fwlink/p/?LinkId=2124703' -OutFile "$webView2.part" -UseBasicParsing
  Move-Item "$webView2.part" $webView2 -Force
}
Assert-MicrosoftSigned $webView2

# 4. Compile
$innoKeys = 'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\Inno Setup 6_is1',
            'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\Inno Setup 6_is1',
            'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\Inno Setup 6_is1'
$iscc = @((Get-Command ISCC.exe -ErrorAction SilentlyContinue).Source) +
        @(Get-ItemProperty $innoKeys -ErrorAction SilentlyContinue | Where-Object InstallLocation | ForEach-Object { Join-Path $_.InstallLocation 'ISCC.exe' }) +
        "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe" |
        Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
if (-not $iscc) { throw 'Inno Setup 6 (ISCC.exe) not found. Install it from https://jrsoftware.org/isdl.php' }

& $iscc /Q "/DAppVersion=$Version" "/DDotnetVersion=$DotnetVersion" "/DPublishDir=$PublishDir" (Join-Path $Root 'installer\setup.iss')
if ($LASTEXITCODE) { throw "Inno Setup failed (exit code $LASTEXITCODE)" }
Write-Host "Built $(Join-Path $Root "dist\ID-Card-Printing-Software-Free-Setup-$Version.exe")"
