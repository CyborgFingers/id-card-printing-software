// ID Card Printing Software Free - Copyright (c) 2026 Josh McNabb. All rights reserved. See LICENSE.txt.
// Which page size a card prints on. Pure so it can be tested without a printer (used by WindowsPrinter).
namespace IdCard.Printing;

public static class CardPaper
{
    /// <summary>Index of the first driver paper whose name (upper case, spaces and dashes removed)
    /// contains the card size's name, e.g. "CR-80 Card" for CR80; -1 when none does.</summary>
    public static int FindDriverPaper(IReadOnlyList<string?> paperNames, CardSize size)
    {
        var want = Normalise(size.Name);
        if (want.Length == 0) return -1;
        for (var i = 0; i < paperNames.Count; i++)
            if (Normalise(paperNames[i]).Contains(want, StringComparison.Ordinal)) return i;
        return -1;
    }

    /// <summary>The portrait card size in hundredths of an inch, for a custom paper size.</summary>
    public static (int Width, int Height) Hundredths(CardSize size) => (ToHundredths(size.WidthMm), ToHundredths(size.HeightMm));

    static int ToHundredths(double mm) => (int)Math.Round(mm / 25.4 * 100, MidpointRounding.AwayFromZero);

    static string Normalise(string? name) => (name ?? "").ToUpperInvariant().Replace(" ", "").Replace("-", "");
}
