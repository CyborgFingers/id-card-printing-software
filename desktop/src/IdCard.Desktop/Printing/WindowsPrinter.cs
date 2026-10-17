// ID Card Printing Software Free - Copyright (c) 2026 Josh McNabb. All rights reserved. See LICENSE.txt.
// The real printer: prints through the printer's own Windows driver (System.Drawing.Printing), lists
// printers and cancels jobs through WMI. Port of print-card.ps1, printers.ps1 and WindowsPrinter in
// printer.js. Card images are decoded in memory and never written to disk. The status monitor is in
// WindowsPrinter.Monitor.cs.
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Printing;
using System.Management;
using IdCard.Printing;

namespace IdCard.Desktop.Printing;

public sealed partial class WindowsPrinter : IPrinter
{
    static readonly TimeSpan PrintTimeout = TimeSpan.FromSeconds(120);
    readonly Func<PrinterSettingsSnapshot> _settings;

    public WindowsPrinter(Func<PrinterSettingsSnapshot> settings) => _settings = settings;

    /// <summary>Sends one card (front, then the optional back) as one print job. Runs on its own STA
    /// thread (as the old PowerShell did); after 120 s it gives up waiting and reports MaybeSpooled.</summary>
    public async Task<PrintResult> PrintAsync(PrintJob job, CancellationToken ct = default)
    {
        ct.ThrowIfCancellationRequested();
        var printer = _settings().PrinterName;
        if (string.IsNullOrWhiteSpace(printer))
            return new PrintResult(false, Error: "No printer is selected. Choose your card printer in Settings.");

        var done = new TaskCompletionSource<string>(TaskCreationOptions.RunContinuationsAsynchronously);
        var thread = new Thread(() =>
        {
            try { done.TrySetResult(PrintCard(printer, job)); }
            catch (Exception ex) { done.TrySetException(ex); }
        }) { IsBackground = true, Name = "Card print" };
        thread.SetApartmentState(ApartmentState.STA);
        thread.Start();

        // ponytail: a print stuck in the driver can't be aborted; its thread finishes (or not) on its own.
        try { return new PrintResult(true, Info: await done.Task.WaitAsync(PrintTimeout, ct)); }
        catch (TimeoutException)
        {
            return new PrintResult(false, Error: "Sending the card to the printer took more than 2 minutes, so it may still print.", MaybeSpooled: true);
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            return new PrintResult(false, Error: "Stopped while the card was being sent to the printer, so it may still print.", MaybeSpooled: true);
        }
        catch (InvalidPrinterException) { return new PrintResult(false, Error: NotInstalled(printer)); }
        catch (Exception ex) { return new PrintResult(false, Error: (ex.InnerException ?? ex).Message); }
    }

    static string NotInstalled(string printer) => $"Printer '{printer}' is not installed on this PC.";

    static string PrintCard(string printer, PrintJob job)
    {
        using var pd = new PrintDocument { DocumentName = job.DocName, PrintController = new StandardPrintController() };
        pd.PrinterSettings.PrinterName = printer;
        if (!pd.PrinterSettings.IsValid) throw new InvalidOperationException(NotInstalled(printer));

        var pages = new List<Image>();
        try
        {
            pages.Add(Decode(job.Front, job.RotateFront));
            if (job.Back is { Length: > 0 }) pages.Add(Decode(job.Back, job.RotateBack));

            var paper = ChoosePaper(pd.PrinterSettings, job.Size);
            pd.DefaultPageSettings.PaperSize = paper;
            pd.DefaultPageSettings.Landscape = paper.Width > paper.Height;   // always a portrait card on the page
            pd.DefaultPageSettings.Margins = new Margins(0, 0, 0, 0);
            pd.OriginAtMargins = false;

            var info = FormattableString.Invariant(
                $"paper={paper.PaperName};dpi={pd.DefaultPageSettings.PrinterResolution.X};canDuplex={pd.PrinterSettings.CanDuplex}");
            if (pages.Count > 1 && job.Duplex)
            {
                if (pd.PrinterSettings.CanDuplex) { pd.PrinterSettings.Duplex = Duplex.Vertical; info += ";duplex=on"; }
                else info += ";duplex=driver";
            }

            var i = 0;
            pd.PrintPage += (_, e) =>
            {
                DrawCard(e, pages[i]);
                i++;
                e.HasMorePages = i < pages.Count;
            };
            pd.Print();
            return info;
        }
        finally
        {
            foreach (var p in pages) p.Dispose();
        }
    }

    /// <summary>The driver's own paper for this card size (e.g. "CR80"), otherwise a custom portrait size.</summary>
    static PaperSize ChoosePaper(PrinterSettings settings, CardSize size)
    {
        var driverSizes = settings.PaperSizes.Cast<PaperSize>().ToList();
        var i = CardPaper.FindDriverPaper(driverSizes.Select(s => s.PaperName).ToList(), size);
        if (i >= 0) return driverSizes[i];
        var (width, height) = CardPaper.Hundredths(size);
        return new PaperSize(size.Name, width, height);
    }

    static Bitmap Decode(byte[] png, bool rotate180)
    {
        Bitmap bmp;
        try
        {
            using var ms = new MemoryStream(png, writable: false);
            using var src = Image.FromStream(ms);
            bmp = new Bitmap(src);   // a copy that no longer needs the stream
        }
        catch (Exception ex) when (ex is ArgumentException or OutOfMemoryException)
        {
            throw new InvalidOperationException("The card image could not be read.");
        }
        if (rotate180) bmp.RotateFlip(RotateFlipType.Rotate180FlipNone);
        return bmp;
    }

    static void DrawCard(PrintPageEventArgs e, Image img)
    {
        var g = e.Graphics!;
        g.InterpolationMode = InterpolationMode.HighQualityBicubic;
        g.PixelOffsetMode = PixelOffsetMode.HighQuality;
        g.SmoothingMode = SmoothingMode.HighQuality;
        // The origin is the printable area's corner; move it to the paper's corner so the card fills the page.
        g.TranslateTransform(-e.PageSettings.HardMarginX, -e.PageSettings.HardMarginY);
        var r = e.PageBounds;
        if ((r.Height >= r.Width) != (img.Height >= img.Width))
        {
            // Landscape card on the portrait page: turn it a quarter so it fills the page.
            g.TranslateTransform(r.Width, 0);
            g.RotateTransform(90);
            g.DrawImage(img, 0, 0, r.Height, r.Width);
        }
        else
        {
            g.DrawImage(img, 0, 0, r.Width, r.Height);
        }
    }

    /// <summary>Removes this printer's queued job(s) with this document name. A job that has already
    /// finished is fine; any other failure throws.</summary>
    public Task CancelJobAsync(string docName) => Task.Run(() =>
    {
        var printer = _settings().PrinterName;
        if (string.IsNullOrWhiteSpace(printer)) return;
        using var searcher = new ManagementObjectSearcher($"SELECT * FROM Win32_PrintJob WHERE Document='{Wql(docName)}'");
        using var jobs = searcher.Get();
        foreach (ManagementObject job in jobs)
        {
            using (job)
            {
                if (!IsJobOf(job, printer)) continue;
                try { job.Delete(); }
                catch (ManagementException ex) when (ex.ErrorCode == ManagementStatus.NotFound) { }   // already gone
            }
        }
    });

    public Task<IReadOnlyList<PrinterInfo>> ListPrintersAsync() => Task.Run<IReadOnlyList<PrinterInfo>>(() =>
    {
        using var searcher = new ManagementObjectSearcher("SELECT * FROM Win32_Printer");
        using var printers = searcher.Get();
        var list = new List<PrinterInfo>();
        foreach (ManagementObject p in printers)
            using (p) list.Add(new PrinterInfo(Str(p["Name"]), Str(p["DriverName"]), Str(p["PortName"]), p["Default"] is true, p["WorkOffline"] is true));
        return list;
    });

    public void OpenPreferences() => PrintUi("/e");

    public void OpenQueue() => PrintUi("/o");

    void PrintUi(string page)
    {
        var printer = _settings().PrinterName;
        if (string.IsNullOrWhiteSpace(printer)) return;
        var start = new ProcessStartInfo("rundll32.exe") { UseShellExecute = false };
        foreach (var arg in new[] { "printui.dll,PrintUIEntry", page, "/n", printer }) start.ArgumentList.Add(arg);
        using var _ = Process.Start(start);
    }
}
