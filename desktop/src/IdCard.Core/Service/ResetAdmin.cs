// ID Card Printing Software Free - Copyright (c) 2026 Josh McNabb. All rights reserved. See LICENSE.txt.
// Emergency sign-in reset: puts the "admin" account back to admin / admin as an administrator (a new
// password must be chosen at the next sign-in). The Windows program only runs it for a Windows administrator.
using IdCard.Data;
using IdCard.Security;

namespace IdCard.Service;

public static class ResetAdmin
{
    public static void Run(string dataDir, string key)
    {
        var file = Path.Combine(dataDir, AppService.DbFileName);
        if (!File.Exists(file)) throw new InvalidOperationException("There is no database on this PC yet.");
        using var db = Db.Open(file, key, AppService.AppId);
        var now = Js.Now();
        db.Tx(() =>
        {
            var u = db.Row("SELECT id FROM users WHERE username = 'admin' COLLATE NOCASE");
            if (u is not null) db.Exec("UPDATE users SET password_hash = ?, is_default_password = 1, role = 'admin', updated_at = ? WHERE id = ?", Passwords.Hash("admin"), now, u["id"]);
            else db.Exec("INSERT INTO users(username, password_hash, is_default_password, created_at, updated_at, role) VALUES ('admin', ?, 1, ?, ?, 'admin')", Passwords.Hash("admin"), now, now);
            db.Exec("DELETE FROM sessions WHERE user_id = (SELECT id FROM users WHERE username = 'admin' COLLATE NOCASE)");
            db.Exec("INSERT INTO app_log(ts, level, message) VALUES (?, ?, ?)", now, "warning", "Sign-in for \"admin\" was reset to the default password on this PC");
        });
    }
}
