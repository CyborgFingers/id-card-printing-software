// ID Card Printing Software Free - Copyright (c) 2026 Josh McNabb. All rights reserved. See LICENSE.txt.
// Live printer status (port of printer-monitor.ps1): polls the spooler through WMI, the FARGO driver's
// PrinterDriverData registry values and the printer's jobs, and raises StatusChanged after every poll.
using System.Globalization;
using System.Management;
using System.Text;
using IdCard.Printing;
using Microsoft.Win32;

namespace IdCard.Desktop.Printing;

public sealed partial class WindowsPrinter
{
    const int DefaultPollMs = 1500;
    static readonly string[] FargoValueNames =
        ["RibbonInfo", "FilmInfo", "CardCount", "PrinterStatus", "PrinterError", "DeviceError", "ConfigInfo", "ConfigInfoDriver"];

    readonly Lock _gate = new();
    CancellationTokenSource? _monitor;

    public event Action<PrinterRaw?>? StatusChanged;

    public PrinterRaw? Latest { get; private set; }

    public void Restart()
    {
        var settings = _settings();
        var cts = new CancellationTokenSource();
        lock (_gate)
        {
            _monitor?.Cancel();
            _monitor = cts;
        }
        Latest = null;
        if (string.IsNullOrWhiteSpace(settings.PrinterName))
        {
            StatusChanged?.Invoke(null);
            return;
        }
        var pollMs = settings.PollMs > 0 ? settings.PollMs : DefaultPollMs;
        _ = Task.Run(() => PollLoop(settings.PrinterName, pollMs, cts.Token));
    }

    // ponytail: the CancellationTokenSource is not disposed; it has no timer or wait handle to release.
    public void Stop()
    {
        lock (_gate)
        {
            _monitor?.Cancel();
            _monitor = null;
        }
    }

    public void Dispose() => Stop();

    /// <summary>StatusChanged handlers must not throw: an exception ends the loop.</summary>
    async Task PollLoop(string printer, int pollMs, CancellationToken ct)
    {
        try
        {
            while (true)
            {
                var raw = Poll(printer);
                ct.ThrowIfCancellationRequested();   // a restart happened during the poll: drop it
                Latest = raw;
                StatusChanged?.Invoke(raw);
                await Task.Delay(pollMs, ct);
            }
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested) { }
    }

    /// <summary>One status reading. The status text and FARGO values are extras: if only they fail, the
    /// reading still counts (Found stays true) and MonitorError says what was missing.</summary>
    static PrinterRaw Poll(string printer)
    {
        try
        {
            using var p = QueryOne($"SELECT * FROM Win32_Printer WHERE Name='{Wql(printer)}'");
            if (p is null) return new PrinterRaw { Found = false };

            string? extraError = null;
            var statusText = "";
            try { statusText = ReadStatusText(printer); }
            catch (Exception ex) { extraError = "Printer status text unavailable: " + ex.Message; }
            Dictionary<string, string>? fargo = null;
            try { fargo = ReadFargo(printer); }
            catch (Exception ex) { extraError ??= "Printer driver values unavailable: " + ex.Message; }

            return new PrinterRaw
            {
                Found = true,
                PrinterStatus = Int(p["PrinterStatus"]),
                DetectedErrorState = Int(p["DetectedErrorState"]),
                ExtendedDetectedErrorState = Int(p["ExtendedDetectedErrorState"]),
                PrinterState = p["PrinterState"] is null ? 0 : Convert.ToInt64(p["PrinterState"], CultureInfo.InvariantCulture),
                WorkOffline = p["WorkOffline"] is true,
                PortName = Str(p["PortName"]),
                DriverName = Str(p["DriverName"]),
                Dpi = Int(p["HorizontalResolution"]),   // the driver's print resolution (300 or 600 on card printers)
                StatusText = statusText,
                Fargo = fargo,
                Jobs = ReadJobs(printer),
                MonitorError = extraError,
            };
        }
        catch (Exception ex)
        {
            return new PrinterRaw { MonitorError = ex.Message };
        }
    }

    /// <summary>The same text Get-Printer's PrinterStatus gives ("Normal", "Paused, Offline", "PaperJam"…).</summary>
    static string ReadStatusText(string printer)
    {
        using var p = QueryOne($"SELECT PrinterStatus FROM MSFT_Printer WHERE Name='{Wql(printer)}'", @"root\StandardCimv2");
        return p?["PrinterStatus"] is { } v ? ((GetPrinterStatus)Convert.ToUInt32(v, CultureInfo.InvariantCulture)).ToString() : "";
    }

    /// <summary>FARGO drivers keep live supply and status values here (ribbon %, film %, card count, codes).</summary>
    static Dictionary<string, string>? ReadFargo(string printer)
    {
        using var key = Registry.LocalMachine.OpenSubKey($@"SYSTEM\CurrentControlSet\Control\Print\Printers\{printer}\PrinterDriverData");
        if (key is null) return null;
        var values = new Dictionary<string, string>();
        foreach (var name in FargoValueNames)
        {
            var text = key.GetValue(name) switch
            {
                null => null,
                byte[] bytes => Encoding.ASCII.GetString(bytes).Replace("\0", "").Trim(),
                string[] lines => string.Join(" ", lines),
                var v => Convert.ToString(v, CultureInfo.InvariantCulture),
            };
            if (text is not null) values[name] = text;
        }
        return values;
    }

    static List<RawJob> ReadJobs(string printer)
    {
        using var searcher = new ManagementObjectSearcher("SELECT * FROM Win32_PrintJob");
        using var all = searcher.Get();
        var jobs = new List<RawJob>();
        foreach (ManagementObject j in all)
        {
            using (j)
            {
                if (IsJobOf(j, printer))
                    jobs.Add(new RawJob(Int(j["JobId"]), Str(j["Document"]), Str(j["JobStatus"]), Int(j["StatusMask"]), Int(j["PagesPrinted"]), Int(j["TotalPages"])));
            }
        }
        return jobs;
    }

    /// <summary>Win32_PrintJob.Name is "&lt;printer&gt;, &lt;job id&gt;".</summary>
    static bool IsJobOf(ManagementObject job, string printer) =>
        job["Name"] is string name && name.StartsWith(printer + ", ", StringComparison.OrdinalIgnoreCase);

    static ManagementObject? QueryOne(string wql, string scope = @"root\cimv2")
    {
        using var searcher = new ManagementObjectSearcher(scope, wql);
        using var results = searcher.Get();
        return results.OfType<ManagementObject>().FirstOrDefault();
    }

    /// <summary>Escapes a value for a single-quoted WQL string.</summary>
    static string Wql(string value) => value.Replace(@"\", @"\\").Replace("'", @"\'");

    static int Int(object? value) => value is null ? 0 : (int)Convert.ToInt64(value, CultureInfo.InvariantCulture);

    static string Str(object? value) => value as string ?? "";

    /// <summary>Get-Printer's PrinterStatus flags (MSFT_Printer, Microsoft.PowerShell.Cmdletization.GeneratedTypes.Printer.PrinterStatus).
    /// Flags enum ToString joins the names with ", " exactly like PowerShell's [string] did.</summary>
    [Flags]
    enum GetPrinterStatus : uint
    {
        Normal = 0, Paused = 1, Error = 2, PendingDeletion = 4, PaperJam = 8, PaperOut = 16, ManualFeed = 32,
        PaperProblem = 64, Offline = 128, IoActive = 256, Busy = 512, Printing = 1024, OutputBinFull = 2048,
        NotAvailable = 4096, Waiting = 8192, Processing = 16384, Initializing = 32768, WarmingUp = 65536,
        TonerLow = 131072, NoToner = 262144, PagePunt = 524288, UserIntervention = 1048576, OutOfMemory = 2097152,
        DoorOpen = 4194304, ServerUnknown = 8388608, PowerSave = 16777216, ServerOffline = 33554432,
        DriverUpdateNeeded = 67108864,
    }
}
