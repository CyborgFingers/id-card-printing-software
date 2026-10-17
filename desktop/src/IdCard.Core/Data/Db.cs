// ID Card Printing Software Free - Copyright (c) 2026 Josh McNabb. All rights reserved. See LICENSE.txt.
// Encrypted SQLite storage. The whole database file (and its WAL journal) is encrypted with AES-256
// (SQLCipher 4 format) by SQLite3 Multiple Ciphers, the same format the 2.x versions wrote, so an
// existing database and its backups open unchanged.
using System.Text;
using Microsoft.Data.Sqlite;

namespace IdCard.Data;

public sealed class BadKeyException(string message) : Exception(message);

/// <summary>One connection, used by one thread at a time (the service serialises access).</summary>
public sealed class Db : IDisposable
{
    public const int SchemaVersion = 4;
    const string Schema = """
        CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
        CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT);
        CREATE TABLE IF NOT EXISTS users (
          id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL UNIQUE COLLATE NOCASE, password_hash TEXT NOT NULL,
          is_default_password INTEGER NOT NULL DEFAULT 0, created_at TEXT, updated_at TEXT, last_login_at TEXT, role TEXT);
        CREATE TABLE IF NOT EXISTS sessions (
          token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          created_at TEXT NOT NULL, last_seen_at TEXT NOT NULL, expires_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS clients (
          id TEXT PRIMARY KEY, name TEXT NOT NULL, contact_name TEXT, contact_email TEXT, contact_phone TEXT, notes TEXT,
          default_design_id TEXT, created_at TEXT, updated_at TEXT);
        CREATE TABLE IF NOT EXISTS designs (
          id TEXT PRIMARY KEY, client_id TEXT REFERENCES clients(id) ON DELETE CASCADE, name TEXT NOT NULL, data TEXT NOT NULL,
          updated_at TEXT, position INTEGER);
        CREATE INDEX IF NOT EXISTS ix_designs_client ON designs(client_id);
        CREATE TABLE IF NOT EXISTS client_designs (
          client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE, design_id TEXT NOT NULL REFERENCES designs(id) ON DELETE CASCADE,
          PRIMARY KEY (client_id, design_id));
        CREATE TABLE IF NOT EXISTS assets (name TEXT PRIMARY KEY, mime TEXT NOT NULL, data BLOB NOT NULL, created_at TEXT);
        CREATE TABLE IF NOT EXISTS people (
          id TEXT PRIMARY KEY, client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
          first_name TEXT, last_name TEXT, reference TEXT, notes TEXT, staff_id TEXT, position TEXT, title TEXT, address TEXT,
          photo BLOB, photo_mime TEXT, photo_name TEXT, photo_adj TEXT,
          created_at TEXT, updated_at TEXT, last_printed_at TEXT, print_count INTEGER NOT NULL DEFAULT 0, extra TEXT, card_status TEXT);
        CREATE INDEX IF NOT EXISTS ix_people_client ON people(client_id, last_name, first_name);
        CREATE TABLE IF NOT EXISTS batches (
          id TEXT PRIMARY KEY, client_id TEXT, name TEXT, created_at TEXT, status TEXT, sides TEXT, design TEXT, data TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS queue_items (
          id TEXT PRIMARY KEY, batch_id TEXT NOT NULL REFERENCES batches(id) ON DELETE CASCADE, person_id TEXT,
          seq INTEGER, first_name TEXT, last_name TEXT, status TEXT, attempts INTEGER, error TEXT, data TEXT NOT NULL);
        CREATE INDEX IF NOT EXISTS ix_items_batch ON queue_items(batch_id, seq);
        CREATE TABLE IF NOT EXISTS card_images (
          item_id TEXT NOT NULL REFERENCES queue_items(id) ON DELETE CASCADE, side TEXT NOT NULL, png BLOB NOT NULL,
          PRIMARY KEY (item_id, side));
        CREATE TABLE IF NOT EXISTS print_history (
          id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL, client_id TEXT, client_name TEXT, person_id TEXT,
          first_name TEXT, last_name TEXT, status TEXT, sides TEXT, batch TEXT, batch_id TEXT, design TEXT, printer TEXT,
          operator TEXT, ribbon INTEGER, film INTEGER, note TEXT, design_id TEXT);
        CREATE INDEX IF NOT EXISTS ix_history_ts ON print_history(ts);
        CREATE INDEX IF NOT EXISTS ix_history_client ON print_history(client_id, ts);
        CREATE TABLE IF NOT EXISTS printer_events (
          id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL, type TEXT, code TEXT, level TEXT, title TEXT, detail TEXT);
        CREATE TABLE IF NOT EXISTS supply_log (
          id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL, ribbon_part TEXT, ribbon INTEGER, film_part TEXT, film INTEGER, card_count INTEGER);
        CREATE TABLE IF NOT EXISTS app_log (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL, level TEXT, message TEXT);
        CREATE INDEX IF NOT EXISTS ix_log_ts ON app_log(ts);
        """;
    /// <summary>Copy order for backup and restore (parents before children).</summary>
    static readonly string[] Tables = ["meta", "settings", "users", "clients", "designs", "client_designs", "assets", "people", "batches", "queue_items", "card_images", "print_history", "printer_events", "supply_log", "app_log"];

    static Db() => SQLitePCL.Batteries_V2.Init();

    readonly SqliteConnection _c;
    int _txDepth;

    Db(SqliteConnection c) => _c = c;

    static SqliteConnection Connect(string file, string key, bool readOnly = false)
    {
        var cs = new SqliteConnectionStringBuilder { DataSource = file, Pooling = false, Mode = readOnly ? SqliteOpenMode.ReadOnly : SqliteOpenMode.ReadWriteCreate }.ToString();
        var c = new SqliteConnection(cs);
        c.Open();
        Cipher(c, key);
        return c;
    }

    static void Cipher(SqliteConnection c, string key)
    {
        Raw(c, "PRAGMA cipher = 'sqlcipher'");
        Raw(c, "PRAGMA legacy = 4");            // SQLCipher 4: AES-256 + HMAC-SHA512, PBKDF2 key derivation
        Raw(c, $"PRAGMA key = '{key.Replace("'", "''")}'");
    }

    static void Raw(SqliteConnection c, string sql) { using var cmd = c.CreateCommand(); cmd.CommandText = sql; cmd.ExecuteNonQuery(); }

    public static Db Open(string file, string key, string appName)
    {
        var c = Connect(file, key);
        try { Raw(c, "SELECT COUNT(*) FROM sqlite_master"); }
        catch (SqliteException e) when (e.SqliteErrorCode == 26) { c.Dispose(); throw new BadKeyException("The database could not be unlocked with this PC's key."); }   // SQLITE_NOTADB
        catch { c.Dispose(); throw; }
        var db = new Db(c);
        db.Scalar("PRAGMA journal_mode = WAL");
        db.Exec("PRAGMA synchronous = FULL");
        db.Exec("PRAGMA foreign_keys = ON");
        db.Exec("PRAGMA busy_timeout = 5000");
        db.Exec("PRAGMA secure_delete = ON");    // overwrite deleted data instead of leaving it in free pages
        db.Exec(Schema);
        db.Migrate();
        const string meta = "INSERT INTO meta(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value";
        db.Exec(meta, "app", appName);
        db.Exec(meta, "schema_version", SchemaVersion.ToString());
        if (db.Row("SELECT value FROM meta WHERE key = 'created_at'") is null) db.Exec(meta, "created_at", Service.Js.Now());
        return db;
    }

    public void Dispose() => _c.Dispose();

    // ---------- queries ----------
    SqliteCommand Command(string sql, object?[] args)
    {
        var cmd = _c.CreateCommand();
        var sb = new StringBuilder(sql.Length + 16);
        int n = 0; char quote = '\0';
        foreach (var ch in sql)
        {
            if (quote != '\0') { if (ch == quote) quote = '\0'; sb.Append(ch); continue; }
            if (ch is '\'' or '"') { quote = ch; sb.Append(ch); continue; }
            if (ch == '?') { sb.Append("@p").Append(n++); continue; }
            sb.Append(ch);
        }
        if (n != args.Length) throw new ArgumentException($"SQL has {n} parameters but {args.Length} values were given.");
        cmd.CommandText = sb.ToString();
        for (int i = 0; i < args.Length; i++) cmd.Parameters.AddWithValue("@p" + i, args[i] switch { null => DBNull.Value, bool b => b ? 1 : 0, var v => v });
        return cmd;
    }

    public int Exec(string sql, params object?[] args) { using var cmd = Command(sql, args); return cmd.ExecuteNonQuery(); }

    public object? Scalar(string sql, params object?[] args) { using var cmd = Command(sql, args); var v = cmd.ExecuteScalar(); return v is DBNull ? null : v; }

    public long Count(string sql, params object?[] args) => Convert.ToInt64(Scalar(sql, args) ?? 0L);

    public List<Dictionary<string, object?>> Rows(string sql, params object?[] args)
    {
        using var cmd = Command(sql, args);
        using var r = cmd.ExecuteReader();
        var list = new List<Dictionary<string, object?>>();
        while (r.Read())
        {
            var row = new Dictionary<string, object?>(r.FieldCount);
            for (int i = 0; i < r.FieldCount; i++) row[r.GetName(i)] = r.IsDBNull(i) ? null : r.GetValue(i);
            list.Add(row);
        }
        return list;
    }

    public Dictionary<string, object?>? Row(string sql, params object?[] args) => Rows(sql, args).FirstOrDefault();

    /// <summary>Runs fn in one transaction (nested calls join the outer one).</summary>
    public void Tx(Action fn)
    {
        if (_txDepth > 0) { _txDepth++; try { fn(); } finally { _txDepth--; } return; }
        Exec("BEGIN IMMEDIATE");
        _txDepth = 1;
        try { fn(); _txDepth = 0; Exec("COMMIT"); }
        catch { _txDepth = 0; try { Exec("ROLLBACK"); } catch (SqliteException) { } throw; }
    }

    // ---------- upgrades ----------
    void AddColumns(string table, params string[] names)
    {
        var have = Rows($"PRAGMA table_info({table})").Select(c => (string)c["name"]!).ToHashSet();
        foreach (var c in names) if (!have.Contains(c)) Exec($"ALTER TABLE {table} ADD COLUMN {c} TEXT");
    }

    void Migrate()
    {
        AddColumns("people", "staff_id", "position", "title", "address", "extra", "card_status");   // extra: custom field values (JSON)
        AddColumns("users", "role");                 // NULL = admin (accounts from before roles)
        AddColumns("print_history", "design_id");
        if (Row("SELECT value FROM meta WHERE key = 'migrated_v3'") is null)
        {
            Tx(() =>
            {
                // v2 kept the staff/ID number in "reference"; v2 templates belonged to one client.
                Exec("UPDATE people SET staff_id = reference WHERE (staff_id IS NULL OR staff_id = '') AND reference IS NOT NULL AND reference != ''");
                Exec("INSERT OR IGNORE INTO client_designs(client_id, design_id) SELECT client_id, id FROM designs WHERE client_id IS NOT NULL AND client_id IN (SELECT id FROM clients)");
                Exec("INSERT INTO meta(key, value) VALUES ('migrated_v3', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", Service.Js.Now());
            });
        }
        // Up to 2.2 the starter template's id was the old product name + '-standard' (generated ids never contain '-').
        var old = Row("SELECT id FROM designs WHERE id GLOB '*-standard'");
        if (old is not null && Row("SELECT 1 FROM designs WHERE id = 'standard'") is null)
        {
            var id = old["id"];
            Tx(() =>
            {
                Exec("INSERT INTO designs(id, client_id, name, data, updated_at, position) SELECT 'standard', client_id, name, json_set(data, '$.id', 'standard'), updated_at, position FROM designs WHERE id = ?", id);
                Exec("UPDATE client_designs SET design_id = 'standard' WHERE design_id = ?", id);
                Exec("UPDATE clients SET default_design_id = 'standard' WHERE default_design_id = ?", id);
                Exec("DELETE FROM designs WHERE id = ?", id);
            });
        }
    }

    // ---------- backups: the whole database, encrypted with its own password ----------
    public static void DeleteWithJournals(string file)
    {
        foreach (var s in new[] { "", "-wal", "-shm", "-journal" }) { try { File.Delete(file + s); } catch (IOException) { } catch (UnauthorizedAccessException) { } }
    }

    /// <summary>Writes an encrypted backup protected by its own password (so it can be restored on another PC).</summary>
    public static void ExportBackup(string file, string mainFile, string mainKey, string password, string appName)
    {
        DeleteWithJournals(file);
        using var b = new Db(Connect(file, password));
        b.Exec("PRAGMA foreign_keys = OFF");
        b.Exec("ATTACH DATABASE ? AS src KEY ?", mainFile, mainKey);
        try
        {
            foreach (var r in b.Rows("SELECT type, name, sql FROM src.sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY type = 'index'"))
                b.Exec((string)r["sql"]!);
            b.Tx(() => { foreach (var t in Tables) b.Exec($"INSERT INTO main.{t} SELECT * FROM src.{t}"); });
            b.Exec("INSERT INTO main.meta(key, value) VALUES ('backup_of', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", appName);
        }
        finally { b.Exec("DETACH DATABASE src"); }
    }

    public sealed record BackupInfo(long Clients, long People, long History, long Queued);

    /// <summary>Checks a backup file with its password and says what it holds.</summary>
    public static BackupInfo InspectBackup(string file, string password, string[] appNames)
    {
        if (!File.Exists(file)) throw new InvalidOperationException("The backup file is missing.");
        using var b = new Db(Connect(file, password, readOnly: true));
        string? app;
        try { app = b.Scalar("SELECT value FROM meta WHERE key = 'app'") as string; }
        catch (SqliteException) { throw new InvalidOperationException("Wrong backup password, or the file is not an ID Card Printing Software backup."); }
        if (app is null || !appNames.Contains(app)) throw new InvalidOperationException("That file is not an ID Card Printing Software backup.");
        long N(string t) { try { return b.Count($"SELECT COUNT(*) FROM {t}"); } catch (SqliteException) { return 0; } }
        return new BackupInfo(N("clients"), N("people"), N("print_history"), N("queue_items"));
    }

    /// <summary>Replaces everything in this database with the backup's contents.</summary>
    public void RestoreBackup(string file, string password, string[] appNames)
    {
        Exec("PRAGMA foreign_keys = OFF");
        try
        {
            Exec("ATTACH DATABASE ? AS src KEY ?", file, password);
            try
            {
                var app = Scalar("SELECT value FROM src.meta WHERE key = 'app'") as string;
                if (app is null || !appNames.Contains(app)) throw new InvalidOperationException("That file is not an ID Card Printing Software backup.");
                Tx(() =>
                {
                    foreach (var t in Tables.Reverse()) Exec($"DELETE FROM main.{t}");
                    foreach (var t in Tables)
                    {
                        var src = Rows($"PRAGMA src.table_info({t})").Select(c => (string)c["name"]!).ToList();
                        if (src.Count == 0) continue;
                        var mine = Rows($"PRAGMA main.table_info({t})").Select(c => (string)c["name"]!).ToHashSet();
                        var cols = string.Join(", ", src.Where(mine.Contains).Select(c => $"\"{c}\""));
                        Exec($"INSERT INTO main.{t} ({cols}) SELECT {cols} FROM src.{t}");
                    }
                });
                Exec("UPDATE main.meta SET value = ? WHERE key = 'app'", appNames[0]);
            }
            finally { Exec("DETACH DATABASE src"); }
        }
        finally { Exec("PRAGMA foreign_keys = ON"); }
        Migrate();   // the backup may come from an older version
    }
}
