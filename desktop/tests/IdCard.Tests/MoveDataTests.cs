// ID Card Printing Software Free - Copyright (c) 2026 Josh McNabb. All rights reserved.
// Bringing a Windows account's own database (3.0.11 and earlier) into the shared data folder.
using IdCard.Data;
using IdCard.Service;

namespace IdCard.Tests;

public sealed class MoveDataTests : IDisposable
{
    const string OldKey = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef", SharedKey = "fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210";
    readonly string _root = Path.Combine(Path.GetTempPath(), "idcard-move-" + Guid.NewGuid().ToString("N"));
    string Account => Path.Combine(_root, "account");
    string Shared => Path.Combine(_root, "shared");
    int _keysMade, _asked;
    bool _answer;

    public MoveDataTests() { Directory.CreateDirectory(Account); Directory.CreateDirectory(Shared); }
    public void Dispose() => Directory.Delete(_root, true);

    string Key(bool allowCreate) { if (allowCreate) _keysMade++; return SharedKey; }
    bool Ask(MoveData.Contents mine, MoveData.Contents shared) { _asked++; return _answer; }
    string? Move() => MoveData.FromAccount(Account, OldKey, Shared, Key, Ask);
    static bool Kept(string dir, string marker) => Directory.GetFiles(dir, AppService.DbFileName + marker + "*").Length == 1;

    static void MakeDb(string dir, string key, params string[] clients)
    {
        using var db = Db.Open(Path.Combine(dir, AppService.DbFileName), key, AppService.AppId);
        foreach (var c in clients) db.Exec("INSERT INTO clients(id, name) VALUES (?, ?)", c, c);
    }

    static List<string> Clients(string dir, string key)
    {
        using var db = Db.Open(Path.Combine(dir, AppService.DbFileName), key, AppService.AppId);
        return db.Rows("SELECT name FROM clients ORDER BY name").Select(r => (string)r["name"]!).ToList();
    }

    [Fact]
    public void An_accounts_data_moves_in_when_there_is_no_shared_data_yet()
    {
        MakeDb(Account, OldKey, "Example Company");
        Assert.NotNull(Move());
        Assert.Equal(["Example Company"], Clients(Shared, SharedKey));   // now opens with the shared key
        Assert.Equal(1, _keysMade);
        Assert.False(File.Exists(Path.Combine(Account, AppService.DbFileName)));
        Assert.True(Kept(Account, ".old-"));
        Assert.Null(Move());   // only once
        Assert.Equal(0, _asked);
    }

    [Fact]
    public void When_both_have_data_the_shared_data_stays_unless_the_person_chooses_theirs()
    {
        MakeDb(Shared, SharedKey, "Sample Organisation");
        MakeDb(Account, OldKey, "Example Company", "Second Example");
        Move();
        Assert.Equal(1, _asked);
        Assert.Equal(["Sample Organisation"], Clients(Shared, SharedKey));
        Assert.True(Kept(Account, ".old-"));
        Assert.Equal(0, _keysMade);
    }

    [Fact]
    public void Choosing_the_accounts_data_keeps_the_shared_data_beside_it()
    {
        MakeDb(Shared, SharedKey, "Sample Organisation");
        MakeDb(Account, OldKey, "Example Company");
        _answer = true;
        Move();
        Assert.Equal(["Example Company"], Clients(Shared, SharedKey));
        Assert.True(Kept(Shared, ".replaced-"));
    }

    [Fact]
    public void An_untouched_shared_database_gives_way_without_asking_and_is_kept()
    {
        MakeDb(Shared, SharedKey);
        MakeDb(Account, OldKey, "Example Company");
        Move();
        Assert.Equal(0, _asked);
        Assert.Equal(["Example Company"], Clients(Shared, SharedKey));
        Assert.True(Kept(Shared, ".replaced-"));
    }

    [Fact]
    public void A_changed_sign_in_counts_as_shared_data_in_use()
    {
        MakeDb(Shared, SharedKey);
        using (var db = Db.Open(Path.Combine(Shared, AppService.DbFileName), SharedKey, AppService.AppId))
            db.Exec("INSERT INTO users(username, password_hash, is_default_password) VALUES ('admin', 'x', 0)");
        MakeDb(Account, OldKey, "Example Company");
        Move();
        Assert.Equal(1, _asked);
        Assert.Empty(Clients(Shared, SharedKey));
    }

    [Fact]
    public void An_untouched_account_database_never_replaces_the_shared_one()
    {
        MakeDb(Shared, SharedKey);
        MakeDb(Account, OldKey);
        Move();
        Assert.Equal(0, _asked);
        Assert.Empty(Directory.GetFiles(Shared, "*.replaced-*"));
        Assert.True(Kept(Account, ".old-"));
    }
}
