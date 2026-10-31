# ID Card Printing Software Free

Copyright (c) 2026 Josh McNabb. All rights reserved. Proprietary freeware: see `legal/LICENSE.txt`.
Free to use; may not be resold, redistributed or reverse engineered. Every source file carries the
copyright header — keep it on new files.

## What it is

A Windows program for designing and printing ID cards (CR80, CR79, CR100 or a custom size; templates
are drawn in 300 dpi pixels, CR80 portrait = 638 × 1013 px) on card printers, primarily HID FARGO
(**HDP5000**, USB). Version 3 is a **64-bit .NET 10 (LTS) desktop program**: it runs the print service
in-process (ASP.NET Core/Kestrel on `http://localhost:5180`, loopback only), shows the screens in its
own window (WebView2), sits in the notification area, and prints one card at a time through the
printer's Windows driver. It is installed by an Inno Setup installer that also installs the .NET 10
runtimes and the WebView2 Runtime when they're missing, and it updates itself from GitHub releases.

**Printing is Windows only** (System.Drawing.Printing, WMI, FARGO driver registry values, DPAPI).
`IdCard.DevHost` runs the same service on macOS/Linux with a **simulated printer** so everything
else can be developed and tested on a Mac. The simulator lives only in the DevHost project: the released
Windows program has no simulator mode (`ServiceOptions.Simulator` is null there, so Settings hides the
switch, `simulate` is forced off and `/api/printer/simulate` doesn't exist). `IDCARD_DEMO_PRINTER=1`
makes the DevHost present the simulated printer as an ordinary installed "Card Printer" with no
simulator mode, which is how the README screenshots are taken.

## Run it on a Mac (development)

```bash
dotnet build desktop/src/IdCard.DevHost
IDCARD_DB_KEY=dev-only-key IDCARD_DATA=.devdata IDCARD_WEBROOT=web dotnet desktop/src/IdCard.DevHost/bin/Debug/net10.0/IdCard.DevHost.dll
open http://localhost:5180
node tools/smoke.mjs              # second terminal: end-to-end check through the simulator
node tools/api-check.mjs          # after smoke: fields, card status, export, sizes, roles, automatic backups
dotnet test desktop/tests/IdCard.Tests   # C# unit tests (scrypt, fields, backups, card sizes, printer status, paper)
node --test tools/test/           # the screens' own logic (CSV import, card dates)
```
- `dotnet` is `~/.dotnet/dotnet` (SDK 10). `IDCARD_WEBROOT=web` serves the screens straight from `web/`
  (no rebuild after editing them); `IDCARD_PORT` changes the port.
- Sign in with the default login **admin / admin**. It must choose its own password before anything
  else works (the API answers 403 until it does), then accept the licence. `tools/smoke.mjs` on a fresh
  `.devdata/` does this itself and sets the password to `smoke-test-password` (override: `SMOKE_PASS`).
- `.devdata/` holds the dev database (git-ignored). Delete it to start fresh.
- DevHost only: Settings → Printer → Simulator mode; the printer drawer (click the sidebar status card)
  can inject simulated faults (ribbon out, card jam, offline…).
- `dotnet build desktop/src/IdCard.Desktop` builds the Windows program on the Mac (EnableWindowsTargeting).

## Build the Windows installer

See `tools/build-installer.sh` (Mac: publishes, downloads and SHA512-checks the runtimes, compiles the
setup on a Windows machine over ssh) and `tools/build-installer.ps1` (on Windows with Inno Setup 6).
Output: `dist/ID-Card-Printing-Software-Free-Setup-<version>.exe`. The version lives in
`desktop/Directory.Build.props` (`<Version>`); the installer's AppId must never change.
Releases: a GitHub release on `CyborgFingers/id-card-printing-software` with the setup attached is
what installed copies update to (`AppService.UpdateRepo`).
To release: bump `<Version>`, add `.github/release-notes/vX.Y.Z.md` (shown on the release page and
behind the app's "What's new" link), commit, push, then push the tag `vX.Y.Z`.

**Updates change only what they're for (the owner's standing rule).** Installing a new version must not
delete anything, change any setting or do anything except add or change that release's features. Before
every release, check the diff against this:
- **Data**: never delete or rewrite people, photos, templates, clients, history or sign-ins. Database
  changes only add tables or columns (`Db.Migrate`); a template format upgrade must keep its meaning, and
  start-up never saves over rows it can't read.
- **Settings**: never change a saved setting. Every setting is written down at start (`LoadConfig`), so a
  changed default only reaches new installs. A brand-new setting must default to how the program behaved
  before, unless that behaviour is the release's point and the release notes say so.
- **Setup**: an in-app update (`/UPDATE`) replaces program files only. It leaves shortcuts and the data
  folder alone (`Check: not IsUpdate`), and never adds a [Run], registry or delete entry beyond that.
- **Anything one-off** (moving data, changing where things live, turning something on for existing
  installs) needs the owner's explicit OK first, keeps the old copy, and is named in the release notes.
- `UpdateKeepsDataTests` starts the service as one version and again as the next: it must still pass.

## Layout

```
desktop/src/IdCard.Core/        The service (net10.0, cross-platform)
  ServiceHost.cs                Kestrel on localhost, starts/stops the service
  Service/AppService*.cs        State + config, sign-in, printer events, designs/clients, queue + print
                                worker, history, supplies, live updates (SSE), backups, updates
  Service/Js.cs                 JSON helpers with JavaScript's coercions, so stored data keeps its shape
  Service/Fields.cs             Custom person fields: definitions (config.customFields), values (people.extra), card numbers
  Service/AutoBackup.cs         Automatic encrypted backups to a folder: when due, write, prune
  Service/ResetAdmin.cs         Emergency sign-in reset ("--reset-admin")
  Data/Db.cs                    Encrypted SQLite (SQLCipher 4 via SQLite3 Multiple Ciphers), schema, migrations, backup/restore
  Security/Passwords.cs         scrypt password hashes (same format as 2.x)
  Printing/Printing.cs          IPrinter contract, CardSize, PrintJob
  Printing/PrinterStatus.cs     Raw spooler/FARGO data → plain-English alerts (deriveStatus)
  Printing/CardPaper.cs         Which paper a card prints on (driver paper by name, else custom size)
  Http/Router.cs                Localhost/Host/Origin checks, route table + auth gates, static files
  Http/Routes*.cs               The API: auth/users/settings, clients/people/fields, designs/queue, history/backups/updates
desktop/src/IdCard.Desktop/     The Windows program (WinExe, net10.0-windows, x64): Program (one copy per session, one
                                print service per PC, --background, --reset-admin, update runner), TrayApp, MainWindow (WebView2),
                                KeyStore (DPAPI), Printing/WindowsPrinter*.cs (driver printing, WMI monitor)
desktop/src/IdCard.DevHost/     The service with a simulated printer on any OS (SimPrinter.cs; development only)
desktop/tests/IdCard.Tests/     xUnit tests
desktop/tools/IdCard.PrintCheck/  Windows printing test harness (publish self-contained, run on a test PC)
web/                            The screens (served from wwwroot): index.html, app.css, js/app.js (views),
                                js/admin.js (admin settings), js/builder.js (template builder),
                                js/render.js (card renderer), js/proof.js, js/csv.js, js/helpview.js (Help page),
                                js/enhance.js (Enhance + photoCheck), js/face.js (face finder for Line up faces),
                                js/vendor/ (bwip-js, libheif, utif, pica, mediapipe)
web/js/legal.js                 GENERATED by tools/gen-legal.mjs — do not edit
web/js/help.js                  GENERATED by tools/gen-help.mjs from docs/USER-GUIDE.md — do not edit
docs/USER-GUIDE.md              The user guide (GitHub) and source of the in-program Help; each "## " is a topic.
                                After editing it run: node tools/gen-help.mjs (a web test fails until you do)
legal/                          LICENSE.txt, THIRD-PARTY-NOTICES.txt, SUPPORTED-PRINTERS.txt (source of truth)
installer/                      Inno Setup script; redist/ (downloaded runtimes, git-ignored)
tools/                          build-installer.sh/.ps1, gen-legal.mjs, gen-help.mjs, smoke.mjs, api-check.mjs, test/
```

## Key design decisions (keep these)

- **The screens never send anything off the PC.** The service sends `Content-Security-Policy: connect-src 'self' blob: data:`
  (Router.cs SecurityHeaders), so no script can make a request anywhere but the service. Network calls (the update
  check) are made by the service. ⚠️ `web/js/vendor/mediapipe/vision_bundle.mjs` is PATCHED: MediaPipe logs usage to
  Google (odml.pa.googleapis.com) every 60 s by default; our copy's logger starts in its "failed" state (header at the
  top of the file). When upgrading MediaPipe, re-apply that patch and check the new bundle for other network calls.
- **Photos keep the person's real look.** Enhance (js/enhance.js) never corrects colour casts (a light-blue backdrop
  looks like a blue cast) and never lightens faces to a set brightness (a shadowed face looks like darker skin). Bulk
  Enhance only touches photos photoCheck finds off (flat or grainy), never judged by file size. Settings → Photos has
  two switches, both OFF by default (new settings keep the old behaviour): enhancePhotos (Enhance photos that need it:
  every new photo, one at a time, import or bulk update) and alignFaces (Line up faces on every card: render.js
  setLineUpFaces, one switch for all templates; a template's fit stays Fill the frame / Whole photo). Line up faces only
  positions the photo (adj.face: the point between the eyes and the face's size); it never changes it. A photo too
  tight to reach the spot grows up to FACE.grow, then leaves up to FACE.slack uncovered, filled with a blurred wash of
  its edge rows/columns (never mirrored: mirroring copied faces). Tested end to end with 300 synthetic faces
  (scratch harness, not in the repo): about 90% within 15 px of the eye target; misses are side profiles.
- **Photo problems are reported, never hidden.** render.js photoIssues (noPhoto, noFace, turned, close, small, poor)
  drives the list labels, Show → Needs checking, and the end-of-run report (runReport in app.js) after an import,
  bulk update or Line up faces. They come from what's saved with each photo (adj.face incl. `turned`, adj.photo
  {w, h, poor}); photos saved before 3.0.15 are only checked for noPhoto. face.js `turned` = eyes < 0.75 of front on
  or nose > 0.6 of the eye spacing to one side, calibrated on 293 faces: no front-on face flagged.

- **No plain files.** All data and settings live in the one encrypted DB file
  (`C:\ProgramData\ID Card Printing Software\id-card-printing-software.db` on Windows), shared by every
  Windows account on the PC (setup's [Dirs] grants Users modify). Card images go from the database to the
  printer driver in memory. Backups are encrypted with a user-chosen backup password (`.idcbak`); the
  `transfer/` folder only ever holds those briefly. Each account's own `%LOCALAPPDATA%\ID Card Printing
  Software` keeps only its WebView2 data and update downloads (never the shared folder: the setup runs
  elevated from there) and `transfer/` (a junction there could aim its clean-up anywhere). Up to 3.0.11
  (and in 2.x) the DB lived there, one per account; MoveData brings it into the shared folder once
  (re-encrypted with the shared key via ExportBackup): automatically when there's no shared DB or it's
  untouched (no templates/clients/people/history/batches, admin still on the default password), else only if
  the person says Yes to a one-time question. The loser is renamed (`.old-<stamp>` / `.replaced-<stamp>`),
  never deleted. Same cipher settings as 2.x. Known gap: the 3.x updater starts setup with runas, so the
  /UPDATE relaunch runs as whoever approved UAC; a standard user who types another admin's password gets
  the app back as that admin (their own data moves at their next sign-in, via the question).
- **DB key** is tied to the PC (DPAPI LocalMachine, `C:\ProgramData\ID Card Printing Software\database.key`).
  A copied DB can't be opened elsewhere; backups are the way to move data. The old per-account key
  (`HKCU\Software\ID Card Printing Software\DatabaseKey`, CurrentUser DPAPI) is only read to move old data.
  `--reset-admin` asks for Windows admin rights (any account can open the shared data).
- **Update pause**: the queue meta saves `pausedForUpdateFrom` (version); the same version starting again
  (another session's copy taking over mid-update) keeps waiting. Setup's PrepareToInstall kills every copy
  from {app} in every session (WMI) because Restart Manager can't close other sessions' copies.
- **One print service per PC.** The copy holding `Global\IDCardPrintingSoftwareFree.Service` runs it; a copy
  in another Windows session (or account) opens only its window onto `http://localhost:5180` and takes the
  service over (5 s check) once the holder exits.
- **One thread at a time**: like the Node service it replaced, all state and the one SqliteConnection
  are used under the service "gate" (`AppService.Locked`/`LockedAsync`). Request bodies are read
  before taking it and replies written after; printing, waits and downloads never hold it. Printer
  events arrive on other threads and are applied on the gate (newest wins).
- **Print worker** (`PrintOne` in AppService.Queue.cs): one card at a time; marks item `sending` → spools →
  watches the spooler job + printer busy state → `printed`. Errors pause the queue
  (`pauseOnError`). Anything mid-print at startup becomes `interrupted` ("Check output") so a card is
  never printed twice without a person confirming.
- **Dual-sided**: `cardSides` (single/dual) + `backMethod` (auto = flipper; manual = print fronts,
  flip stack, "Print backs" creates a back-only batch). The test HDP5000 reports `FlipperModule=0`.
- **FARGO supplies**: read from `HKLM\SYSTEM\CurrentControlSet\Control\Print\Printers\<name>\PrinterDriverData`
  (`RibbonInfo`, `FilmInfo` → `PercentRemaining`, `CardCount`, `ConfigInfo`). Real values from the
  test printer: ribbon part 84051 69%, film 84053 90%, CardCount 542.
- **Templates** are a library (`designs`), assigned to clients (`client_designs`). Each template has
  `elements` (photo/firstName/lastName/staffId/position/title/address/text) with x/y/w/h in card px,
  per side, plus `fields` (ticked fields). A client's people get inputs for the union of fields used
  by its templates.
- **Licence acceptance**: `AppService.LicenseVersion` must match `legal/LICENSE.txt`
  ("Licence version X.Y"). Raising it forces everyone to accept again on next sign-in.
- **Security**: localhost-only, Host/Origin checks, HttpOnly SameSite=Strict session cookie, scrypt
  password hashes, sign-in lockout, idle timeout, all API routes require auth except
  `/api/auth/login`, `/api/auth/me`, `/api/branding`, `/api/branding/logo`. While the account still has
  the default password only routes marked `defaultOk` (logout, change account) work.
- **Starter template** id is `'standard'`; `Db.Migrate()` renames the old 2.2 id (also after a restore).
- **Card sizes**: `design.card` = `{ w, h, size, mmW, mmH }` (`AppService.CleanCard`): CR80 638×1013
  (kept from 2.x), CR79 615×991, CR100 791×1163, custom 20–150 mm per side; landscape when w > h;
  a missing size is CR80. A print batch copies the template's `card`; `PrintSize` turns it into the
  portrait `CardSize` the printer gets (a custom size is named like `60x90mm` so no driver paper
  matches it by accident). WindowsPrinter uses the driver's paper whose name contains the size name,
  else a custom paper size, and rotates a landscape image onto the portrait page. Element kinds: person fields, `text`, `photo`, `image`
  (asset), `box` (shape), `barcode` (bwip-js; `source` = a person field or `text`). Text and barcodes
  have `rotate` 0/90/180/270; date fields have `dateFormat`. `CleanDesign` validates all of it.
- **Print resolution**: template coordinates are always 300 dpi pixels. The status monitor reports the
  driver's `Win32_Printer.HorizontalResolution` as `printer.dpi`; for 600 dpi printers `queueCards`
  renders at scale 2 (1276×2026), which WindowsPrinter draws to fill the page. 600 dpi card PNGs are
  about 4× larger in the database until finished batches are cleared.
- **Any card printer**: printing goes through the printer's own Windows driver. FARGO extras (ribbon/
  film %, card count, flipper) come from the driver's `PrinterDriverData` and are only shown, warned
  about or used when reported; wording never names a model except in SUPPORTED-PRINTERS.txt and the
  Automatic print adjustments switch (which names the model it recognised).
- **Print adjustments** (Settings > Printer, `PrintTuning`): Darkness (gamma), Contrast (S curve) and
  Colour (saturation) plus Overprint mm, applied by WindowsPrinter to the card bitmap only when printing.
  `printAuto` (default on) uses `PrintTuning.ForPrinter` values for HID FARGO HDP5000/5600/HDPii (matched on
  printer or driver name; shown as `printer.autoTuning`). Only pure black may end up pure black and white
  stays white: FARGO drivers print pure black with the resin K panel (cards are one bitmap, so that needs the
  driver's "Print All Black with K Panel"). Template pictures have their own Darkness/Contrast/Colour
  (`bgDarkness`… on a side, `darkness`… on photo/image elements), drawn by render.js `toned()` with a pixel
  LUT, never CSS filters (CSS contrast() clips shadows to pure black).
- **Person fields**: definitions in `config.customFields` (keys `cf_…`), changed only via `/api/fields`
  (so stale clients can't roll back card-number counters). Values in `people.extra`. Dates are stored
  as YYYY-MM-DD. One date field may be the card expiry.
- **Roles**: `users.role` is `admin` (NULL = admin, for older accounts) or `operator`. Admin-only
  routes have `admin: true` or are listed in `Routes.Register` (`AdminOnly`). New and reset accounts
  get `is_default_password = 1`, which forces a new password (the same gate as admin / admin).
- **Card status**: `people.card_status` NULL (active), `lost`, `returned`; changes are written to
  print_history (status lost/returned/active). Printing a card makes it active again.
- **Automatic backups**: settings in `config.autoBackup`; the password is in `meta.autobackup_password`
  (never in the config, which is sent to the screens). Checked every 10 minutes.
- **No console window, no Exit in the tray**: closing the window hides it (printing carries on);
  Settings > close the program (admin, `/api/service/stop`) ends it. `--background` (the Startup
  shortcut) starts it without the window; a second launch brings the window forward.
- **Notifications come from the tray icon, not the page**: the service calls `ServiceOptions.Notify`
  (all printed, a new printer alert while cards are waiting, a card that didn't send, cards to check
  after a restart) when "Desktop notifications" is on; TrayApp shows a Windows notification and a
  click opens the print queue. The WebView's own notification permission is denied on Windows so
  nothing shows twice; the DevHost prints them as `[notification]` lines.
- **Updates**: `AppService.Update.cs` checks `releases/latest` of `UpdateRepo` (1 min after start, then
  every 12 h). A release must attach `ID-Card-Printing-Software-Free-Setup-<version>.exe`; GitHub's asset
  `digest` (sha256) is required and checked after download. "Update now" (admin) runs the setup with
  `/VERYSILENT /SUPPRESSMSGBOXES /NORESTART /UPDATE` (UAC prompt) and the program closes; the setup
  reopens it. `IDCARD_UPDATE_FEED` overrides the feed URL for testing.

## Gotchas

- The screens rely on exact JSON shapes from the old Node service; `Js.cs` reproduces JavaScript's
  coercions (`String()`, `Number()`, `!!`, `||`). Keep using it in routes, and run `tools/api-check.mjs`.
- `Microsoft.Data.Sqlite` binds named parameters only: `Db` rewrites each `?` to `@pN` (outside quotes).
- CSV responses start with U+FEFF (the BOM spreadsheet programs need).
- Drag-and-drop in the builder uses the `text/x-idcard-field` MIME type.
- UI copy style: plain NZ English ("licence" noun, "colour", "centre"), short and direct, no tips.

## TODO

1. **First real-printer test** (HDP5000). Verified on Windows 11 with the PDF test printer (2026-10-17,
   3.0): install over 2.3 keeps the data and passwords, CR80/CR79/CR100/custom cards, portrait and
   landscape, two-sided pages, Rotate back 180°, queue → printed, cancel by document name, status
   monitor, 600 dpi cards for a 600 dpi printer, Update now (3.0.0 → 3.0.1 from a test feed).
   Still to check on the real printer: the driver's own CR80 paper; dual-sided through the flipper and
   how a landscape back lines up; ribbon/film % and card count from the FARGO registry values; printer
   alerts (ribbon out, jam…); barcodes scan; CR79/CR100 on a printer that takes them.
2. Code signing: decided against (2026-10-17). Josh wants it free: the setup stays unsigned, so the
   first install shows SmartScreen ("More info" > "Run anyway") and UAC "unknown publisher"; updates
   through Update now only show UAC. Free routes checked: Microsoft Store (not wanted), open source +
   SignPath (licence change), winget (command line). NZ individuals can't use Azure Artifact Signing.
3. Inno Setup licence: free for commercial use, but jrsoftware asks businesses over US$5,000/yr to buy
   one (optional). Josh to decide.
4. While at the printer: magstripe encoding and the UV (F) panel can be driven from text in the print
   job (`~1`–`~3`, `~T`/`~I`, see the HDP5000 user guide). Smart card encoding needs HID's licensed SDK.
5. Feature ideas (pick with Josh): webcam photo capture with a crop guide (face auto-crop later);
   conditional elements (e.g. a CONTRACTOR band by Position); import from Active Directory or Gallagher
   Command Centre; supply cost per card; more than one printer; split app.js by area.
6. Have the licence reviewed by a lawyer before wide distribution (NZ law, NZ$1 liability cap, CGA
   business clause). No contact details are in it yet.

## Testing on Windows (no card printer needed)

- The service's key is DPAPI LocalMachine, which works over SSH (`--background` starts it headless). Moving an
  account's 3.0.11-and-earlier data reads that account's CurrentUser DPAPI key, which fails over SSH with key
  authentication ("Access is denied"): test it in a signed-in desktop session, or as SYSTEM from a scheduled
  task (SYSTEM's own DPAPI works headless; its data is in C:\Windows\System32\config\systemprofile). SSH and
  SYSTEM share session 0, which also tests a second Windows account in the same session.
- Test printer: `Add-PrinterPort -Name C:\Test\card.pdf` then
  `Add-Printer -Name "Test Card Printer (PDF)" -DriverName "Microsoft Print To PDF" -PortName C:\Test\card.pdf`.
  Every card printed lands in that PDF (overwritten each time) with no Save dialog; render it to check.
- From another machine: `ssh -L 5180:127.0.0.1:5180 user@pc` keeps the Host header `localhost:5180`,
  so the app accepts it (it only answers loopback with a localhost Host).
- Updates: a Debug build reads `IDCARD_UPDATE_FEED` (a user environment variable) for a test feed; serve
  a `latest.json` plus the setup to the PC (`ssh -R` works). Release builds always use GitHub.
- GUI programs started from SSH need the desktop session: a scheduled task with an Interactive
  principal for the signed-in user (session 0 can't show windows or tray icons).

## Testing approach used so far

3.0 (C#): `tools/smoke.mjs` and `tools/api-check.mjs` (written for the Node service) pass unchanged
against the C# service, plus xUnit tests; Node-made databases and backups open in 3.0 and 3.0 backups
open in 2.x; full install/upgrade/print/update run on a Windows 11 VM. Before 3.0 (Node):

End-to-end in headless Chromium (Playwright) against the simulator: login, licence, clients, people,
CSV + photo import, template builder drag/resize/snap/undo, printing, ribbon-out pause/recovery,
crash (`kill -9`) recovery, backup/restore with right/wrong password, Host/Origin rejection, lockout,
and grepping the DB/WAL files to confirm no readable text. The real HDP5000 has NOT yet printed from
this app — first real-printer test should check dual-sided handling, back orientation
("Rotate back side 180°") and that ribbon % updates after printing.
