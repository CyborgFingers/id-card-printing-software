// ID Card Printing Software Free - Copyright (c) 2026 Josh McNabb. All rights reserved. See LICENSE.txt.
using IdCard.Printing;

namespace IdCard.Tests;

public class CardPaperTests
{
    static CardSize Card(string name) => new[] { CardSize.CR80, CardSize.CR79, CardSize.CR100 }.Single(c => c.Name == name);

    [Fact]
    public void Picks_the_first_driver_paper_whose_name_contains_the_card_size()
    {
        string?[] names = ["Letter", "A4", "CR-80 Card", "CR80 Landscape"];
        Assert.Equal(2, CardPaper.FindDriverPaper(names, CardSize.CR80));
    }

    [Theory]
    [InlineData("cr 80", "CR80")]
    [InlineData("Card cr-79", "CR79")]
    [InlineData("CR100 (67 x 98.5 mm)", "CR100")]
    public void Ignores_case_spaces_and_dashes(string driverName, string size)
    {
        Assert.Equal(1, CardPaper.FindDriverPaper(["Letter", driverName], Card(size)));
    }

    [Theory]
    [InlineData("CR100", "CR80")]
    [InlineData("CR80", "CR100")]
    [InlineData("CR80", "CR79")]
    public void Does_not_take_another_card_size(string driverName, string size)
    {
        Assert.Equal(-1, CardPaper.FindDriverPaper(["Letter", driverName, null], Card(size)));
    }

    [Fact]
    public void A_size_with_no_name_never_matches()
    {
        Assert.Equal(-1, CardPaper.FindDriverPaper(["CR80"], new CardSize("", 50, 80)));
    }

    [Theory]
    [InlineData("CR80", 213, 337)]
    [InlineData("CR79", 205, 330)]
    [InlineData("CR100", 264, 388)]
    public void Custom_paper_is_the_portrait_size_in_hundredths_of_an_inch(string size, int width, int height)
    {
        Assert.Equal((width, height), CardPaper.Hundredths(Card(size)));
    }
}

public class PrintTuningTests
{
    static byte[] Px(params (byte R, byte G, byte B)[] colours) => colours.SelectMany(c => new[] { c.B, c.G, c.R, (byte)255 }).ToArray();

    [Fact]
    public void Darker_and_stronger_colour_keeps_white_and_black()
    {
        var px = Px((255, 255, 255), (0, 0, 0), (128, 128, 128), (200, 120, 60));
        PrintTuning.From(30, 20, 30, 0).Apply(px);
        Assert.Equal(Px((255, 255, 255), (0, 0, 0)), px[..8]);                 // unprinted white stays white, black stays black
        Assert.True(px[8] < 128 && px[8] == px[9] && px[9] == px[10]);          // mid grey is darker and still grey
        Assert.True(px[14] - px[12] > 200 - 60);                                // orange: red and blue further apart (stronger colour)
        Assert.Equal(255, px[15]);                                              // alpha untouched
    }

    [Fact]
    public void Lighter_weaker_and_out_of_range_settings()
    {
        var px = Px((128, 128, 128), (200, 120, 60));
        PrintTuning.From(-30, 0, -50, 0).Apply(px);
        Assert.True(px[0] > 128);                                               // lighter
        Assert.True(px[6] - px[4] < 200 - 60);                                  // weaker colour
        Assert.Equal(PrintTuning.From(50, -50, 0, 2), PrintTuning.From(99, -99, double.NaN, 9));
        Assert.False(PrintTuning.None.ChangesColour);
        var same = Px((10, 20, 30)); PrintTuning.From(0, 0, 0, 1).Apply(same);
        Assert.Equal(Px((10, 20, 30)), same);                                   // overprint alone leaves colours alone
    }
}

public class PrintTuningBlackTests
{
    [Fact]
    public void Only_pure_black_stays_pure_black_so_the_resin_panel_prints_the_same_pixels()
    {
        var px = new byte[256 * 4];
        for (var i = 0; i < 256; i++) { px[i * 4] = px[i * 4 + 1] = px[i * 4 + 2] = (byte)i; px[i * 4 + 3] = 255; }
        PrintTuning.From(50, 50, 50, 0).Apply(px);
        Assert.Equal(0, px[0]);
        for (var i = 1; i < 256; i++) Assert.True(px[i * 4] >= 1, $"grey {i} became pure black");
        Assert.Equal(255, px[255 * 4]);
    }
}

public class PrintTuningModelTests
{
    [Theory]
    [InlineData("HDP5000 Card Printer", "", "HID FARGO HDP5000")]
    [InlineData("Front desk", "HID FARGO HDP5600 Card Printer", "HID FARGO HDP5600")]
    [InlineData("hdpii plus", null, "HID FARGO HDPii")]
    public void Knows_HID_FARGO_HDP_printers_by_printer_or_driver_name(string printer, string? driver, string model)
    {
        var auto = PrintTuning.ForPrinter(printer, driver);
        Assert.Equal(model, auto?.Model);
        Assert.True(auto?.Tuning is { Darkness: > 0, Colour: > 0, OverprintMm: 0 });
    }

    [Theory]
    [InlineData("Test Card Printer (PDF)", "Microsoft Print To PDF")]
    [InlineData("", "")]
    [InlineData("SHDP50001", "Other")]
    public void Other_printers_have_no_automatic_settings(string printer, string driver) => Assert.Null(PrintTuning.ForPrinter(printer, driver));
}
