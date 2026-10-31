// ID Card Printing Software Free - Copyright (c) 2026 Josh McNabb. All rights reserved.
// Logic that needs no running service: passwords, person fields, automatic backups, card sizes, printer status.
using System.Text.Json.Nodes;
using IdCard.Printing;
using IdCard.Security;
using IdCard.Service;

namespace IdCard.Tests;

public class ServiceLogicTests
{
    [Fact]
    public void Scrypt_matches_the_RFC_7914_test_vectors()
    {
        Assert.Equal("77d6576238657b203b19ca42c18a0497f16b4844e3074ae8dfdffa3fede21442fcd0069ded0948f8326a753a0fc81f17e8d3e0fb2e0d3628cf35e20c38d18906",
            Convert.ToHexStringLower(Passwords.Scrypt([], [], 16, 1, 1, 64)));
        Assert.Equal("fdbabe1c9d3472007856e7190d01e9fe7c6ad7cbc8237830e77376634b3731622eaf30d92e22a3886ff109279d9830dac727afb94a83ee6d8360cbdfa2cc0640",
            Convert.ToHexStringLower(Passwords.Scrypt("password"u8.ToArray(), "NaCl"u8.ToArray(), 1024, 8, 16, 64)));
    }

    [Fact]
    public void Passwords_from_version_2_still_work()
    {
        const string fromNode = "scrypt$16384$8$1$y8hkDoJ5IrFetGSXJ6laCQ==$2yeuxqiCpSgosPkBCOGBcZuPJt74dJH9Z6x5GcBPsQKiS2wZrSRWLzZRkNX3Vh57J79dHTyI/AInplD7HjIDFQ==";
        Assert.True(Passwords.Verify("correct horse ✓", fromNode));
        Assert.False(Passwords.Verify("correct horse", fromNode));
        var h = Passwords.Hash("new password");
        Assert.True(Passwords.Verify("new password", h));
        Assert.False(Passwords.Verify("x", "garbage"));
        Assert.False(Passwords.Verify("x", "scrypt$3$8$1$AA==$AA=="));   // not a power of two
    }

    static JsonObject O(string json) => JsonNode.Parse(json)!.AsObject();

    [Fact]
    public void Field_type_is_fixed_once_made_and_expiry_is_only_for_dates()
    {
        var d = Fields.CleanDef(O("""{"key":"cf_abcd1234","label":" Card number ","type":"auto","prefix":"C","digits":20,"next":0}"""))!;
        Assert.Equal("""{"key":"cf_abcd1234","label":"Card number","type":"auto","prefix":"C","digits":9,"next":1}""", d.ToJsonString());
        Assert.Equal("auto", Fields.CleanDef(O("""{"key":"cf_abcd1234","label":"X","type":"date"}"""), d)!["type"]!.ToString());
        Assert.Null(Fields.CleanDef(O("""{"key":"cf_abcd1234","label":"Dept","type":"text","expiry":true}"""))!["expiry"]);
        Assert.Null(Fields.CleanDef(O("""{"key":"bad key","label":"X"}""")));
        Assert.Null(Fields.CleanDef(O("""{"key":"cf_abcd1234","label":"   "}""")));
    }

    [Fact]
    public void Custom_values_check_dates_and_keep_missing_values()
    {
        var defs = JsonNode.Parse("""[{"key":"cf_aaaa","label":"Expiry","type":"date"},{"key":"cf_bbbb","label":"Dept","type":"text"}]""")!.AsArray();
        Assert.Equal("""{"cf_aaaa":"2027-03-31","cf_bbbb":"Ops"}""", Fields.CleanValues(defs, O("""{"cf_aaaa":"2027-03-31","cf_zzzz":"x"}"""), O("""{"cf_bbbb":"Ops"}""")).Values!.ToJsonString());
        Assert.Equal("Expiry must be a date.", Fields.CleanValues(defs, O("""{"cf_aaaa":"31/03/2027"}""")).Error);
        Assert.Equal("{}", Fields.CleanValues(defs, O("""{"cf_bbbb":""}"""), O("""{"cf_bbbb":"Ops"}""")).Values!.ToJsonString());
        Assert.NotNull(Fields.CleanValues(defs, O("""{"cf_aaaa":"2027-02-31"}""")).Error);   // not 3 March
        Assert.NotNull(Fields.CleanValues(defs, O("""{"cf_aaaa":"2027-13-01"}""")).Error);
    }

    [Fact]
    public void Card_numbers_are_padded_in_order_and_never_reused()
    {
        var defs = JsonNode.Parse("""[{"key":"cf_num1","type":"auto","prefix":"C","digits":5,"next":41}]""")!.AsArray();
        JsonObject a = [], b = O("""{"cf_num1":"TYPED"}"""), c = [];
        Assert.True(Fields.AssignNumbers(defs, a)); Assert.Equal("C00041", a["cf_num1"]!.ToString());
        Assert.False(Fields.AssignNumbers(defs, b)); Assert.Equal("TYPED", b["cf_num1"]!.ToString());
        Fields.AssignNumbers(defs, c); Assert.Equal("C00042", c["cf_num1"]!.ToString()); Assert.Equal(43, Js.ToNumber(defs[0]!["next"]));
        Assert.True(Fields.AssignNumbers(defs, O("""{"cf_num1":"C00090"}"""))); Assert.Equal(91, Js.ToNumber(defs[0]!["next"]));
        var current = (JsonObject)defs[0]!.DeepClone(); current["label"] = "Card";
        Assert.Equal(91, Js.ToNumber(Fields.CleanDef(O("""{"key":"cf_num1","label":"Card","next":5}"""), current)!["next"]));   // a stale page can't move it back
    }

    [Fact]
    public void Automatic_backups_are_due_on_schedule()
    {
        var now = DateTime.Parse("2026-10-16T12:00:00Z").ToUniversalTime();
        AutoBackup.Last Ok(string at) => new(at, true, "f", null, at);
        Assert.False(AutoBackup.Due(false, "daily", null, now));
        Assert.True(AutoBackup.Due(true, "daily", null, now));
        Assert.False(AutoBackup.Due(true, "daily", Ok("2026-10-16T01:00:00.000Z"), now));
        Assert.True(AutoBackup.Due(true, "daily", Ok("2026-10-15T11:00:00.000Z"), now));
        Assert.False(AutoBackup.Due(true, "daily", new("2026-10-16T11:30:00.000Z", false, null, "x", null), now));   // retry after an hour
        Assert.False(AutoBackup.Due(true, "weekly", Ok("2026-10-12T12:00:00.000Z"), now));
    }

    [Fact]
    public void Automatic_backups_prune_only_this_PCs_files()
    {
        var dir = Directory.CreateTempSubdirectory("idc-ab-").FullName; var xfer = Directory.CreateTempSubdirectory("idc-x-").FullName;
        try
        {
            foreach (var n in new[] { "2026-01-01-00-00-00", "2026-01-02-00-00-00" }) File.WriteAllText(Path.Combine(dir, $"{AutoBackup.Prefix}{n}.idcbak"), "old");
            string[] keepers = ["ID-Card-Printing-Software-Backup-2025-12-01.idcbak", "ID-Card-Printing-Software-Auto-Backup-OTHERPC-2025-01-01-00-00-00.idcbak", "unrelated.txt"];
            foreach (var f in keepers) File.WriteAllText(Path.Combine(dir, f), "keep");
            var name = AutoBackup.Run(dir, 2, xfer, tmp => File.WriteAllText(tmp, "new"));
            Assert.Equal(new[] { $"{AutoBackup.Prefix}2026-01-02-00-00-00.idcbak", name }.Concat(keepers).Order(), Directory.GetFiles(dir).Select(Path.GetFileName).Order());
            Assert.Empty(Directory.GetFiles(xfer));
            Assert.Throws<InvalidOperationException>(() => AutoBackup.CheckFolder("relative/path"));
            Assert.Throws<InvalidOperationException>(() => AutoBackup.CheckFolder(Path.Combine(dir, "missing")));
        }
        finally { Directory.Delete(dir, true); Directory.Delete(xfer, true); }
    }

    [Fact]
    public void Card_sizes_and_what_the_printer_is_told()
    {
        Assert.Equal("""{"w":638,"h":1013,"size":"CR80","mmW":53.98,"mmH":85.6}""", AppService.CleanCard(null).ToJsonString());
        Assert.Equal("""{"w":1013,"h":638,"size":"CR80","mmW":85.6,"mmH":53.98}""", AppService.CleanCard(O("""{"w":1013,"h":638}""")).ToJsonString());
        Assert.Equal("""{"w":615,"h":991,"size":"CR79","mmW":52.1,"mmH":83.9}""", AppService.CleanCard(O("""{"w":1,"h":2,"size":"CR79"}""")).ToJsonString());
        Assert.Equal(new CardSize("CR100", 67, 98.5), AppService.PrintSize(O("""{"w":2,"h":1,"size":"CR100"}""")));
        Assert.Equal(new CardSize("60x90mm", 60, 90), AppService.PrintSize(O("""{"w":2,"h":1,"size":"custom","mmW":90,"mmH":60}""")));
        Assert.Equal("CR80", AppService.PrintSize(O("""{"size":"custom","mmW":"x"}""")).Name);
    }

    [Fact]
    public void The_queue_carries_on_after_an_update_unless_someone_paused_it_or_a_card_needs_checking()
    {
        Assert.True(AppService.ResumesAfterUpdate(paused: true, pausedForUpdate: true, recovered: 0, justUpdated: true));
        Assert.True(AppService.ResumesAfterUpdate(true, true, 0, justUpdated: false));    // the folder was already tidied: the saved reason still counts
        Assert.False(AppService.ResumesAfterUpdate(true, false, 0, true));                // paused by a person before the update
        Assert.False(AppService.ResumesAfterUpdate(true, true, recovered: 1, true));      // a card to check first
        Assert.False(AppService.ResumesAfterUpdate(false, true, 0, true));                // not paused at all
        Assert.True(AppService.ResumesAfterUpdate(true, pausedForUpdate: null, 0, true)); // saved by 3.0.6 or older, just updated
        Assert.False(AppService.ResumesAfterUpdate(true, null, 0, false));                // saved by an older version, no update: a person's pause
        Assert.False(AppService.ResumesAfterUpdate(true, true, 0, true, sameVersion: true)); // started again before the update installed
    }

    [Fact]
    public void Updates_download_outside_System32_when_the_program_runs_as_SYSTEM()
    {
        const string sys = @"C:\WINDOWS\system32", temp = @"C:\WINDOWS\SystemTemp\";
        Assert.Equal(Path.Combine(temp, "ID Card Printing Software"), AppService.UpdatesFolder(@"C:\Windows\System32\config\systemprofile\AppData\Local\ID Card Printing Software", sys, temp));
        Assert.Equal(@"C:\Users\Jane\AppData\Local\ID Card Printing Software", AppService.UpdatesFolder(@"C:\Users\Jane\AppData\Local\ID Card Printing Software", sys, temp));
        Assert.Equal(@"C:\WINDOWS\system32x\data", AppService.UpdatesFolder(@"C:\WINDOWS\system32x\data", sys, temp));   // only inside System32 itself
        Assert.Equal("/Users/jane/data", AppService.UpdatesFolder("/Users/jane/data", "", "/tmp/"));                   // not Windows: no System32
    }

    static readonly StatusSettings Cfg = new("Card printer", false, 10, 10);

    [Fact]
    public void Printer_status_turns_spooler_states_into_alerts()
    {
        Assert.Equal("No printer selected", PrinterStatus.Derive(null, Cfg with { PrinterName = "" })["label"]!.ToString());
        Assert.Equal("Printer not found", PrinterStatus.Derive(new PrinterRaw { Found = false }, Cfg)["label"]!.ToString());
        var ready = PrinterStatus.Derive(new PrinterRaw { Found = true, PrinterStatus = 3, StatusText = "Normal", Dpi = 600 }, Cfg);
        Assert.Equal("ok", ready["state"]!.ToString()); Assert.Equal(600, (int)ready["dpi"]!);
        var jam = PrinterStatus.Derive(new PrinterRaw { Found = true, DetectedErrorState = 8, StatusText = "PaperJam" }, Cfg);
        Assert.Equal("Card jam", jam["label"]!.ToString());
        var generic = PrinterStatus.Derive(new PrinterRaw { Found = true, Jobs = [new RawJob(1, "IDCard-x", "Error | Printing", 0, 0, 1)] }, Cfg);
        Assert.Equal("attention", generic["alerts"]![0]!["code"]!.ToString());
        var low = PrinterStatus.Derive(new PrinterRaw { Found = true, StatusText = "TonerLow", Fargo = new() { ["RibbonInfo"] = "PartNumber=84051;PercentRemaining=6;0;" } }, Cfg);
        Assert.Equal(["ribbon-low-pct"], low["alerts"]!.AsArray().Select(a => a!["code"]!.ToString()));   // one ribbon warning, not two
        Assert.Equal(6, Js.ToNumber(low["supplies"]!["ribbon"]!["percent"]));
    }
}
