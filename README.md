# ID Card Printing Software Free

Design and print photo ID cards on a card printer, free. Copyright (c) 2026 Josh McNabb. All rights reserved.

Keep clients and their people, design card templates, import people from a spreadsheet with their
photos, and print one card or hundreds through the printer's own Windows driver, with live printer
status and a print history.

## Download

Get the setup program from the [latest release](https://github.com/CyborgFingers/id-card-printing-software/releases/latest)
and run it. Setup installs everything the program needs (the Microsoft .NET 10 runtimes and the
WebView2 Runtime) if they aren't already on the PC. The program checks for new versions and
administrators can install them with **Update now**.

- Windows 10 (1809 or later) or Windows 11, 64-bit
- A card printer with its Windows driver installed (see [supported printers](legal/SUPPORTED-PRINTERS.txt))
- Card sizes: CR80 (85.6 × 54 mm), CR79, CR100 or a custom size, portrait or landscape

## What it does

- Clients, people and photos, with extra fields such as department, expiry date or card number
- A drag-and-drop card template builder: photos, text, images, shapes and barcodes, front and back
- Import from CSV with photos, proof sheets at actual size
- A print queue that prints one card at a time, pauses on printer problems and never prints a card
  twice without asking
- Ribbon and film levels for HID FARGO printers
- Administrator and operator accounts, encrypted storage, encrypted backups (manual and automatic)
- Keeps printing in the background when its window is closed

All data stays on the PC in one encrypted database. Nothing is sent anywhere, apart from the check
for new versions.

## Building from source

The program is C# (.NET 10). The screens are plain HTML, CSS and JavaScript in `web/`.

```bash
dotnet test desktop/tests/IdCard.Tests
dotnet build desktop/src/IdCard.Desktop      # the Windows program
```

The service also runs on macOS or Linux with a simulated printer (`desktop/src/IdCard.DevHost`). The
installer is built with Inno Setup 6 (`tools/build-installer.ps1`). Pushing a version tag (`v3.0.1`)
builds the setup and publishes a release. See `CLAUDE.md` for the full developer notes.

## Licence

Free to use under the [licence](legal/LICENSE.txt). The source is published so you can see how it
works; it is not open source, and the licence still applies (no reselling or redistributing). Third-party
components are listed in [THIRD-PARTY-NOTICES.txt](legal/THIRD-PARTY-NOTICES.txt). Provided as is,
without warranty.
