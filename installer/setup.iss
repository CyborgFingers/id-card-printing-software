; ID Card Printing Software Free - Copyright (c) 2026 Josh McNabb. All rights reserved.
;
; Windows installer (Inno Setup 6). Build it with tools/build-installer.ps1 on Windows, or
; tools/build-installer.sh on a Mac (it compiles on a Windows machine over SSH). By hand:
;   ISCC /DAppVersion=3.0.0 /DDotnetVersion=10.0.13 /DPublishDir=<dotnet publish folder> installer\setup.iss
;
; Installs the .NET 10 Desktop and ASP.NET Core runtimes (bundled, works offline) and the
; Microsoft Edge WebView2 Runtime (bootstrapper, needs internet), each only when it's missing.
;
; The app's updater runs:  setup.exe /VERYSILENT /SUPPRESSMSGBOXES /NORESTART /UPDATE
; /UPDATE is our own switch: start the app again for the signed-in user after a silent install.

#ifndef AppVersion
  #error Pass the version: ISCC /DAppVersion=3.0.0
#endif
#ifndef DotnetVersion
  #error Pass the bundled .NET runtime version: ISCC /DDotnetVersion=10.0.13
#endif
#ifndef PublishDir
  #define PublishDir "..\build\publish"
#endif

#define AppName "ID Card Printing Software Free"
#define AppExe "ID Card Printing Software.exe"
#define AppUrl "https://github.com/CyborgFingers/id-card-printing-software"
#define DesktopRuntime "windowsdesktop-runtime-" + DotnetVersion + "-win-x64.exe"
#define AspNetRuntime "aspnetcore-runtime-" + DotnetVersion + "-win-x64.exe"
#define WebView2Setup "MicrosoftEdgeWebview2Setup.exe"
#define WebView2Key "Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}"

[Setup]
; Never change AppId: upgrades find the existing install by it.
AppId={{2B5FD56E-18B4-4F13-92B7-94617B56B8CD}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher=Josh McNabb
AppCopyright=Copyright (c) 2026 Josh McNabb. All rights reserved.
AppPublisherURL={#AppUrl}
AppSupportURL={#AppUrl}
AppUpdatesURL={#AppUrl}
VersionInfoVersion={#AppVersion}
DefaultDirName={autopf}\{#AppName}
DisableProgramGroupPage=yes
LicenseFile=..\legal\LICENSE.txt
SetupIconFile=..\web\img\app.ico
WizardImageFile=images\wizard-large-100.png,images\wizard-large-125.png,images\wizard-large-150.png,images\wizard-large-175.png,images\wizard-large-200.png
WizardSmallImageFile=images\wizard-small-100.png,images\wizard-small-125.png,images\wizard-small-150.png,images\wizard-small-175.png,images\wizard-small-200.png
UninstallDisplayName={#AppName}
UninstallDisplayIcon={app}\{#AppExe}
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
PrivilegesRequired=admin
MinVersion=10.0.17763
WizardStyle=modern
Compression=lzma2
SolidCompression=yes
OutputDir=..\dist
OutputBaseFilename=ID-Card-Printing-Software-Free-Setup-{#AppVersion}
CloseApplications=force
; After an /UPDATE install [Run] starts the app again, so the Restart Manager mustn't as well.
RestartApplications=no
; The Startup shortcut is per user, as in the older zip version.
UsedUserAreasWarning=no
SetupLogging=yes

[Messages]
WizardLicense=Licence Agreement
LicenseLabel3=Please read the following Licence Agreement. You must accept the terms of this agreement before continuing with the installation.
UninstalledAll=%1 was removed from your computer.%n%nYour people, templates and settings were kept.

[Tasks]
Name: desktopicon; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"
Name: startup; Description: "Start automatically when I sign in to Windows"; GroupDescription: "Startup:"

[InstallDelete]
; [Icons] makes the ticked shortcuts again. This also replaces the per-user shortcuts the older
; zip version made (same names), and removes a shortcut whose task was unticked on an upgrade.
Type: files; Name: "{userdesktop}\{#AppName}.lnk"
Type: files; Name: "{userprograms}\{#AppName}.lnk"
Type: files; Name: "{autodesktop}\{#AppName}.lnk"
Type: files; Name: "{userstartup}\{#AppName}.lnk"

[Files]
; Prerequisites first: with solid compression that keeps extracting them quick.
Source: "redist\{#DesktopRuntime}"; Flags: dontcopy
Source: "redist\{#AspNetRuntime}"; Flags: dontcopy
Source: "redist\{#WebView2Setup}"; Flags: dontcopy
Source: "{#PublishDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "..\legal\LICENSE.txt"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\legal\THIRD-PARTY-NOTICES.txt"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\legal\SUPPORTED-PRINTERS.txt"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{autoprograms}\{#AppName}"; Filename: "{app}\{#AppExe}"; WorkingDir: "{app}"
Name: "{autodesktop}\{#AppName}"; Filename: "{app}\{#AppExe}"; WorkingDir: "{app}"; Tasks: desktopicon
Name: "{userstartup}\{#AppName}"; Filename: "{app}\{#AppExe}"; Parameters: "--background"; WorkingDir: "{app}"; Tasks: startup

[Run]
Filename: "{app}\{#AppExe}"; Description: "Open {#AppName}"; Flags: postinstall nowait skipifsilent runasoriginaluser
Filename: "{app}\{#AppExe}"; Flags: nowait runasoriginaluser; Check: IsUpdate

[Code]
var
  ProgressPage: TOutputMarqueeProgressWizardPage;
  RestartNeeded: Boolean;

function IsUpdate: Boolean;
var
  I: Integer;
begin
  Result := False;
  for I := 1 to ParamCount do
    if CompareText(ParamStr(I), '/UPDATE') = 0 then
      Result := True;
end;

function KeyHasVersion10(const RootKey: Integer; const SubKey: String): Boolean;
var
  Names: TArrayOfString;
  I: Integer;
begin
  Result := False;
  if RegGetValueNames(RootKey, SubKey, Names) then
    for I := 0 to GetArrayLength(Names) - 1 do
      if Pos('10.', Names[I]) = 1 then
        Result := True;
end;

{ True when a 10.x version of this x64 .NET shared framework is installed. The .NET installers
  record versions in the registry (32-bit view); the folder check catches unrecorded installs. }
function HasDotnet10(const Framework: String): Boolean;
var
  SubKey: String;
  Find: TFindRec;
begin
  SubKey := 'SOFTWARE\dotnet\Setup\InstalledVersions\x64\sharedfx\' + Framework;
  Result := KeyHasVersion10(HKLM32, SubKey) or KeyHasVersion10(HKLM64, SubKey);
  if not Result and FindFirst(ExpandConstant('{commonpf64}\dotnet\shared\') + Framework + '\10.*', Find) then
    try
      repeat
        Result := (Find.Attributes and FILE_ATTRIBUTE_DIRECTORY) <> 0;
      until Result or not FindNext(Find);
    finally
      FindClose(Find);
    end;
end;

function WebView2VersionIn(const RootKey: Integer; const SubKey: String): Boolean;
var
  Version: String;
begin
  Result := RegQueryStringValue(RootKey, SubKey, 'pv', Version) and (Version <> '') and (Version <> '0.0.0.0');
end;

function HasWebView2: Boolean;
begin
  Result := WebView2VersionIn(HKLM32, 'SOFTWARE\{#WebView2Key}') or WebView2VersionIn(HKCU, 'Software\{#WebView2Key}');
end;

{ Runs one bundled installer and waits. Returns '' if it worked, otherwise a message for the user. }
function RunInstaller(const FileName, Params, Name: String): String;
var
  Code: Integer;
begin
  Result := '';
  Log('Installing ' + Name);
  ProgressPage.SetText('Installing ' + Name + '...', 'This can take a few minutes.');
  ExtractTemporaryFile(FileName);
  if not Exec(ExpandConstant('{tmp}\') + FileName, Params, '', SW_HIDE, ewWaitUntilTerminated, Code) then
    Result := 'Setup couldn''t start the ' + Name + ' installer: ' + SysErrorMessage(Code)
  else
  begin
    Log(Format('%s installer finished with exit code %d', [Name, Code]));
    { 3010 = installed, restart needed; 1638 = another version of it is already installed }
    if Code = 3010 then
      RestartNeeded := True
    else if (Code <> 0) and (Code <> 1638) then
      Result := Format('Setup couldn''t install the %s (error %d).', [Name, Code]);
  end;
end;

procedure InitializeWizard;
begin
  ProgressPage := CreateOutputMarqueeProgressPage('Installing required components',
    'Setup is installing the Microsoft components {#AppName} needs.');
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  NeedDesktop, NeedAspNet, NeedWebView2: Boolean;
begin
  Result := '';
  NeedDesktop := not HasDotnet10('Microsoft.WindowsDesktop.App');
  NeedAspNet := not HasDotnet10('Microsoft.AspNetCore.App');
  NeedWebView2 := not HasWebView2;
  if not (NeedDesktop or NeedAspNet or NeedWebView2) then
  begin
    Log('The .NET 10 runtimes and the WebView2 Runtime are already installed.');
    Exit;
  end;
  if not WizardSilent then
    ProgressPage.Show;
  try
    if NeedDesktop then
      Result := RunInstaller('{#DesktopRuntime}', '/install /quiet /norestart', 'Microsoft .NET 10 Desktop Runtime');
    if (Result = '') and NeedAspNet then
      Result := RunInstaller('{#AspNetRuntime}', '/install /quiet /norestart', 'Microsoft ASP.NET Core 10 Runtime');
    if (Result = '') and NeedWebView2 then
    begin
      Result := RunInstaller('{#WebView2Setup}', '/silent /install', 'Microsoft Edge WebView2 Runtime');
      if Result <> '' then
        Result := Result + ' It downloads from Microsoft, so this computer must be connected to the internet.';
    end;
  finally
    if not WizardSilent then
      ProgressPage.Hide;
  end;
  if Result <> '' then
    Result := Result + #13#10#13#10 + '{#AppName} was not installed. Fix the problem above, then run Setup again.';
end;

{ The Ready page also lists the Microsoft components Setup will install first. }
function UpdateReadyMemo(Space, NewLine, MemoUserInfoInfo, MemoDirInfo, MemoTypeInfo, MemoComponentsInfo, MemoGroupInfo, MemoTasksInfo: String): String;
var
  Needed: String;
begin
  Needed := '';
  if not HasDotnet10('Microsoft.WindowsDesktop.App') then Needed := Needed + Space + 'Microsoft .NET 10 Desktop Runtime' + NewLine;
  if not HasDotnet10('Microsoft.AspNetCore.App') then Needed := Needed + Space + 'Microsoft ASP.NET Core 10 Runtime' + NewLine;
  if not HasWebView2 then Needed := Needed + Space + 'Microsoft Edge WebView2 Runtime (downloads from Microsoft)' + NewLine;
  Result := MemoDirInfo;
  if MemoTasksInfo <> '' then Result := Result + NewLine + NewLine + MemoTasksInfo;
  if Needed <> '' then Result := Result + NewLine + NewLine + 'Also installs:' + NewLine + Needed;
end;

function NeedRestart: Boolean;
begin
  Result := RestartNeeded;
end;

{ Stops the program if it's running from this install folder. Copies with the same file name in
  other folders (such as the older zip version) keep running. }
procedure StopRunningApp;
var
  Locator, Service, Processes, Process: Variant;
  I, Code: Integer;
  Stopped: Boolean;
begin
  { First ask it to save and close by itself (it waits up to 10 seconds), then stop anything left. }
  if FileExists(ExpandConstant('{app}\{#AppExe}')) then
    Exec(ExpandConstant('{app}\{#AppExe}'), '--exit', '', SW_HIDE, ewWaitUntilTerminated, Code);
  Stopped := False;
  try
    Locator := CreateOleObject('WbemScripting.SWbemLocator');
    Service := Locator.ConnectServer('.', 'root\CIMV2');
    Processes := Service.ExecQuery('SELECT ProcessId, ExecutablePath FROM Win32_Process WHERE Name = ''{#AppExe}''');
    for I := 0 to Processes.Count - 1 do
    begin
      Process := Processes.ItemIndex(I);
      if not VarIsNull(Process.ExecutablePath) and (CompareText(Process.ExecutablePath, ExpandConstant('{app}\{#AppExe}')) = 0) then
      begin
        Log('Stopping the running program, process ' + IntToStr(Process.ProcessId));
        Process.Terminate();
        Stopped := True;
      end;
    end;
  except
    Log('Couldn''t check for a running copy: ' + GetExceptionMessage);
  end;
  if Stopped then
    Sleep(1000); { let Windows release its files }
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
begin
  if CurUninstallStep = usUninstall then
    StopRunningApp;
end;
