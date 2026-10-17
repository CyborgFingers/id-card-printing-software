// ID Card Printing Software Free - Copyright (c) 2026 Josh McNabb. All rights reserved. See LICENSE.txt.
// Test harness for WindowsPrinter (no card printer needed: use a "Microsoft Print To PDF" printer on a file port).
// Publish from desktop/ so the Windows PC needs no .NET installed:
//   dotnet publish tools/IdCard.PrintCheck -c Release -r win-x64 --self-contained true -p:EnableWindowsTargeting=true
// Usage:
//   PrintCheck list
//   PrintCheck print <printer> [--size CR80|CR79|CR100|<w>x<h>] [--size-name NAME] [--landscape] [--back] [--rotate-back]
//                              [--rotate-front] [--no-duplex] [--scale 1|2] [--doc NAME] [--bad-image]
//   PrintCheck monitor <printer> <seconds> [pollMs]
//   PrintCheck restart-test <printer>    switches printers, then checks Stop ends the loop
//   PrintCheck cancel-test <printer>     pauses the printer, prints, cancels by document name, resumes
//   PrintCheck open-queue|open-prefs <printer>
using System.Drawing;
using System.Drawing.Imaging;
using System.Globalization;
using System.Management;
using System.Text.Json;
using IdCard.Desktop.Printing;
using IdCard.Printing;

var command = args.ElementAtOrDefault(0) ?? "";
var printerName = args.ElementAtOrDefault(1) ?? "";
var settings = new PrinterSettingsSnapshot(printerName, 0, 0);
using var printer = new WindowsPrinter(() => settings);

switch (command)
{
    case "list":
        foreach (var p in await printer.ListPrintersAsync()) Console.WriteLine(Json(p));
        return 0;

    case "print":
    {
        var started = DateTime.Now;
        var result = await printer.PrintAsync(MakeJob(args));
        Console.WriteLine($"{Json(result)} ({(DateTime.Now - started).TotalSeconds:0.0} s)");
        return result.Ok ? 0 : 1;
    }

    case "monitor":
    {
        if (args.Length > 3) settings = settings with { PollMs = int.Parse(args[3], CultureInfo.InvariantCulture) };
        printer.StatusChanged += raw => Console.WriteLine(raw is null ? "null" : Json(raw));
        printer.Restart();
        await Task.Delay(TimeSpan.FromSeconds(double.Parse(args.ElementAtOrDefault(2) ?? "3", CultureInfo.InvariantCulture)));
        printer.Stop();
        Console.WriteLine("stopped; latest found=" + printer.Latest?.Found);
        return 0;
    }

    case "restart-test":
    {
        var events = 0;
        printer.StatusChanged += raw =>
        {
            Interlocked.Increment(ref events);
            Console.WriteLine($"{DateTime.Now:HH:mm:ss.fff} {(raw is null ? "null" : $"found={raw.Found} driver={raw.DriverName}")}");
        };
        foreach (var (name, pollMs) in new[] { ("No Such Printer", 300), (printerName, 300), ("", 300) })
        {
            Console.WriteLine($"Restart with '{name}', {pollMs} ms");
            settings = new PrinterSettingsSnapshot(name, pollMs, 0);
            printer.Restart();
            await Task.Delay(1000);
        }
        settings = new PrinterSettingsSnapshot(printerName, 5000, 0);
        printer.Restart();
        await Task.Delay(1000);   // first poll done, now waiting 5 s for the next
        var before = events;
        printer.Stop();
        await Task.Delay(6000);
        Console.WriteLine($"events in the 6 s after Stop: {events - before}");
        return 0;
    }

    case "cancel-test":
    {
        var doc = "PrintCheck-Cancel-" + Environment.TickCount64;
        var seen = new TaskCompletionSource<PrinterRaw>();
        var gone = new TaskCompletionSource<PrinterRaw>();
        printer.StatusChanged += raw =>
        {
            if (raw is null) return;
            if (raw.Jobs.Any(j => j.Document == doc)) seen.TrySetResult(raw);
            else if (seen.Task.IsCompleted) gone.TrySetResult(raw);
        };
        settings = settings with { PollMs = 500 };
        PausePrinter(printerName, pause: true);
        try
        {
            printer.Restart();
            var result = await printer.PrintAsync(MakeJob(["print", printerName, "--back", "--doc", doc]));
            Console.WriteLine("print: " + Json(result));
            Console.WriteLine("seen:  " + Json(await seen.Task.WaitAsync(TimeSpan.FromSeconds(15))));
            await printer.CancelJobAsync(doc);
            Console.WriteLine("gone:  " + Json(await gone.Task.WaitAsync(TimeSpan.FromSeconds(15))));
            await printer.CancelJobAsync(doc);   // a second cancel finds nothing and must not throw
            Console.WriteLine("second cancel ok");
        }
        finally
        {
            printer.Stop();
            PausePrinter(printerName, pause: false);
        }
        return 0;
    }

    case "open-queue": printer.OpenQueue(); return 0;
    case "open-prefs": printer.OpenPreferences(); return 0;

    default:
        Console.Error.WriteLine("Commands: list | print | monitor | cancel-test | open-queue | open-prefs (see Program.cs)");
        return 2;
}

static string Json(object value) => JsonSerializer.Serialize(value);

static void PausePrinter(string name, bool pause)
{
    using var searcher = new ManagementObjectSearcher($"SELECT * FROM Win32_Printer WHERE Name='{name.Replace("'", "\\'")}'");
    foreach (ManagementObject p in searcher.Get())
        using (p) Console.WriteLine($"{(pause ? "Pause" : "Resume")} -> {p.InvokeMethod(pause ? "Pause" : "Resume", null)}");
}

static PrintJob MakeJob(string[] args)
{
    string Opt(string name, string fallback) { var i = Array.IndexOf(args, name); return i >= 0 && i + 1 < args.Length ? args[i + 1] : fallback; }
    bool Has(string name) => args.Contains(name);

    var size = Opt("--size", "CR80") switch
    {
        "CR80" => CardSize.CR80,
        "CR79" => CardSize.CR79,
        "CR100" => CardSize.CR100,
        var wh => new CardSize("Custom", double.Parse(wh.Split('x')[0], CultureInfo.InvariantCulture), double.Parse(wh.Split('x')[1], CultureInfo.InvariantCulture)),
    };
    if (Has("--size-name")) size = size with { Name = Opt("--size-name", size.Name) };   // e.g. to match a driver paper name
    var scale = double.Parse(Opt("--scale", "1"), CultureInfo.InvariantCulture);
    int Px(double mm) => (int)Math.Round(mm / 25.4 * 300 * scale);
    var (w, h) = Has("--landscape") ? (Px(size.HeightMm), Px(size.WidthMm)) : (Px(size.WidthMm), Px(size.HeightMm));
    byte[] front = Has("--bad-image") ? [1, 2, 3] : Card(w, h, "FRONT", Color.Red, Color.Blue);
    var back = Has("--back") ? Card(w, h, "BACK", Color.Gold, Color.Magenta) : null;
    return new PrintJob(front, back, Opt("--doc", "PrintCheck"), !Has("--no-duplex"), Has("--rotate-back"), Has("--rotate-front"), size);
}

// A test card: a black border on the edge, one colour block top-left and another bottom-right,
// so page fill and rotation can be checked in the PDF.
static byte[] Card(int w, int h, string label, Color topLeft, Color bottomRight)
{
    using var bmp = new Bitmap(w, h);
    using (var g = Graphics.FromImage(bmp))
    {
        g.Clear(Color.White);
        using var tl = new SolidBrush(topLeft);
        using var br = new SolidBrush(bottomRight);
        g.FillRectangle(tl, 0, 0, w / 4, h / 8);
        g.FillRectangle(br, w - w / 4, h - h / 8, w / 4, h / 8);
        using var pen = new Pen(Color.Black, 4);
        g.DrawRectangle(pen, 2, 2, w - 4, h - 4);
        using var font = new Font("Arial", Math.Min(w, h) / 6f, GraphicsUnit.Pixel);
        g.DrawString(label, font, Brushes.Black, w / 8f, h / 2f - font.Size);
    }
    using var ms = new MemoryStream();
    bmp.Save(ms, ImageFormat.Png);
    return ms.ToArray();
}
