// ID Card Printing Software Free - Copyright (c) 2026 Josh McNabb. All rights reserved. See LICENSE.txt.
// Settings > Print adjustments: makes up for a printer that prints lighter or duller than the screen, or leaves a
// thin unprinted edge. Applied only to what is sent to the printer; templates, previews and proofs are unchanged.
using System.Text.RegularExpressions;

namespace IdCard.Printing;

/// <summary>Darkness, Contrast and Colour run from -50 to 50 (0 = as designed). Overprint is in millimetres:
/// the card is printed that much larger on every side, so a printer that leaves a white sliver at an edge covers it.</summary>
public sealed partial record PrintTuning(int Darkness, int Contrast, int Colour, double OverprintMm)
{
    public const int Limit = 50;
    public const double MaxOverprintMm = 2;
    public static readonly PrintTuning None = new(0, 0, 0, 0);

    /// <summary>Clamps settings read from the configuration into range.</summary>
    public static PrintTuning From(double darkness, double contrast, double colour, double overprintMm) => new(
        Clamp(darkness), Clamp(contrast), Clamp(colour),
        double.IsFinite(overprintMm) ? Math.Round(Math.Clamp(overprintMm, 0, MaxOverprintMm), 1) : 0);

    static int Clamp(double v) => double.IsFinite(v) ? (int)Math.Round(Math.Clamp(v, -Limit, Limit)) : 0;

    /// <summary>Darkness, Contrast and Colour for a printer model the program knows, found from the printer's or its
    /// driver's name; null for any other printer. HID FARGO HDP printers print through film onto the card and come out
    /// lighter and duller than the screen. These are starting values, chosen from a washed-out HDP5000 test card; tune
    /// them here once more cards have been printed. Overprint isn't set, because these printers already print over the
    /// card's edges.</summary>
    public static (string Model, PrintTuning Tuning)? ForPrinter(string? printerName, string? driverName)
    {
        var m = HdpModel().Match($"{driverName} {printerName}");
        if (!m.Success) return null;
        var model = m.Groups[1].Value.Equals("ii", StringComparison.OrdinalIgnoreCase) ? "HDPii" : "HDP" + m.Groups[1].Value;
        return ($"HID FARGO {model}", new PrintTuning(15, 10, 20, 0));
    }
    [GeneratedRegex(@"\bHDP\s?(5000|5600|ii)", RegexOptions.IgnoreCase)] private static partial Regex HdpModel();

    public bool ChangesColour => Darkness != 0 || Contrast != 0 || Colour != 0;

    /// <summary>Adjusts 32-bit BGRA pixels in place; alpha is kept. White stays white and black stays black, so the
    /// unprinted parts of a card stay unprinted, and only pixels that were pure black end up pure black (HID FARGO
    /// printers can print pure black with the resin K panel, which would look blotchy in a photo's shadows).
    /// Darkness darkens the mid-tones (a gamma curve), Contrast pushes the tones apart from the middle (an S curve),
    /// and Colour makes colours stronger or weaker without changing their brightness.</summary>
    public void Apply(Span<byte> bgra)
    {
        if (!ChangesColour) return;
        var gamma = 1 + Darkness / 100.0;
        var spread = 1 + Contrast / 100.0;
        var tone = new double[256];
        for (var i = 0; i < 256; i++)
        {
            var v = Math.Pow(i / 255.0, gamma);
            tone[i] = i == 0 ? 0 : Math.Max(1, (v < 0.5 ? 0.5 * Math.Pow(2 * v, spread) : 1 - 0.5 * Math.Pow(2 * (1 - v), spread)) * 255);
        }
        var strength = 1 + Colour / 100.0;
        for (var p = 0; p + 3 < bgra.Length; p += 4)
        {
            double b = tone[bgra[p]], g = tone[bgra[p + 1]], r = tone[bgra[p + 2]];
            var grey = 0.299 * r + 0.587 * g + 0.114 * b;
            bgra[p] = Byte(grey + (b - grey) * strength);
            bgra[p + 1] = Byte(grey + (g - grey) * strength);
            bgra[p + 2] = Byte(grey + (r - grey) * strength);
        }
    }

    static byte Byte(double v) => (byte)Math.Round(Math.Clamp(v, 0, 255));
}
