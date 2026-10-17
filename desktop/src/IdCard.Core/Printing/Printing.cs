// ID Card Printing Software Free - Copyright (c) 2026 Josh McNabb. All rights reserved. See LICENSE.txt.
// The printer contract. Windows (IdCard.Windows) talks to the real card printer through its driver;
// SimPrinter stands in everywhere else and for practice.
namespace IdCard.Printing;

/// <summary>A card size. Width and height are the portrait (short side first) size in millimetres.</summary>
public sealed record CardSize(string Name, double WidthMm, double HeightMm)
{
    public static readonly CardSize CR80 = new("CR80", 53.98, 85.60);
    public static readonly CardSize CR79 = new("CR79", 52.10, 83.90);
    public static readonly CardSize CR100 = new("CR100", 67.00, 98.50);
}

/// <summary>One card to print. Images are PNG bytes at the card's aspect ratio (portrait or landscape).</summary>
public sealed record PrintJob(byte[] Front, byte[]? Back, string DocName, bool Duplex, bool RotateBack, bool RotateFront, CardSize Size);

/// <summary>MaybeSpooled: the send timed out or broke after the job may already be in the Windows queue.</summary>
public sealed record PrintResult(bool Ok, string? Info = null, string? Error = null, bool MaybeSpooled = false);

public sealed record PrinterInfo(string Name, string Driver, string Port, bool IsDefault, bool Offline);

public sealed record RawJob(int Id, string Document, string Status, int StatusMask, int PagesPrinted, int TotalPages);

/// <summary>What the status monitor saw on one poll (same fields the old PowerShell monitor wrote as JSON).</summary>
public sealed class PrinterRaw
{
    public DateTimeOffset Ts { get; init; } = DateTimeOffset.UtcNow;
    public bool Found { get; init; }
    public int PrinterStatus { get; init; }
    public int DetectedErrorState { get; init; }
    public int ExtendedDetectedErrorState { get; init; }
    public long PrinterState { get; init; }
    public bool WorkOffline { get; init; }
    public string PortName { get; init; } = "";
    public string DriverName { get; init; } = "";
    /// <summary>The driver's print resolution (Win32_Printer.HorizontalResolution), 0 if unknown.</summary>
    public int Dpi { get; init; }
    public string StatusText { get; init; } = "";
    /// <summary>FARGO driver values from HKLM\SYSTEM\CurrentControlSet\Control\Print\Printers\&lt;name&gt;\PrinterDriverData
    /// (RibbonInfo, FilmInfo, CardCount, PrinterStatus, PrinterError, DeviceError, ConfigInfo, ConfigInfoDriver); null if none.</summary>
    public Dictionary<string, string>? Fargo { get; init; }
    public List<RawJob> Jobs { get; init; } = new();
    public string? MonitorError { get; init; }
}

public sealed record PrinterSettingsSnapshot(string PrinterName, int PollMs, int SimSeconds);

public interface IPrinter : IDisposable
{
    /// <summary>Raised after every status poll (on a background thread).</summary>
    event Action<PrinterRaw?>? StatusChanged;
    PrinterRaw? Latest { get; }
    /// <summary>Starts (or restarts, after the printer or poll interval changed) the status monitor.</summary>
    void Restart();
    void Stop();
    Task<PrintResult> PrintAsync(PrintJob job, CancellationToken ct = default);
    /// <summary>Removes the job with this document name from the Windows queue, if it is still there.</summary>
    Task CancelJobAsync(string docName);
    Task<IReadOnlyList<PrinterInfo>> ListPrintersAsync();
    void OpenPreferences();
    void OpenQueue();
}
