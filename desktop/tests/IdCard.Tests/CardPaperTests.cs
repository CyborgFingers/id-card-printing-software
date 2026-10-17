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
