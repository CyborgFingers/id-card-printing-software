// ID Card Printing Software Free - Copyright (c) 2026 Josh McNabb. All rights reserved. See LICENSE.txt.
// The database key: a random 256-bit key made on first run, protected with Windows DPAPI for this PC and kept beside
// the shared database, so every Windows account on this PC can open it but a copied database can't be opened elsewhere.
// Up to 3.0.11 (and in 2.x) each Windows account had its own key in the registry; OldKey reads it, once, to bring that
// account's data into the shared folder.
using System.Security.Cryptography;
using System.Text;
using Microsoft.Win32;

namespace IdCard.Desktop;

static class KeyStore
{
    const string RegPath = @"Software\ID Card Printing Software";
    const string RegName = "DatabaseKey";
    static string KeyFile => Path.Combine(Program.DataDir, "database.key");

    static string? Read()
    {
        if (!File.Exists(KeyFile)) return null;
        return Encoding.ASCII.GetString(ProtectedData.Unprotect(Convert.FromBase64String(File.ReadAllText(KeyFile).Trim()), null, DataProtectionScope.LocalMachine));
    }

    public static string GetKey(bool allowCreate)
    {
        if (Read() is { } key) return key;
        if (!allowCreate) throw new InvalidOperationException("The database key for this PC was not found.");
        key = Convert.ToHexStringLower(RandomNumberGenerator.GetBytes(32));
        Directory.CreateDirectory(Program.DataDir);
        File.WriteAllText(KeyFile, Convert.ToBase64String(ProtectedData.Protect(Encoding.ASCII.GetBytes(key), null, DataProtectionScope.LocalMachine)));
        // Read it back to prove it round-trips before any data is written with it.
        if (Read() != key) throw new InvalidOperationException("The database key could not be verified after saving.");
        return key;
    }

    /// <summary>This Windows account's own key from 3.0.11 and earlier, or null if it never had one.</summary>
    public static string? OldKey()
    {
        using var k = Registry.CurrentUser.OpenSubKey(RegPath);
        if (k?.GetValue(RegName) is not string v || v.Length == 0) return null;
        return Encoding.ASCII.GetString(ProtectedData.Unprotect(Convert.FromBase64String(v), null, DataProtectionScope.CurrentUser));
    }
}
