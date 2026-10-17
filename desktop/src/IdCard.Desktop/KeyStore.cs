// ID Card Printing Software Free - Copyright (c) 2026 Josh McNabb. All rights reserved. See LICENSE.txt.
// The database key: a random 256-bit key made on first run, protected with Windows DPAPI for this
// Windows account and kept in the registry (the same place 2.x kept it, so an upgrade keeps working).
// Only this Windows account on this PC can unprotect it, so a copied database can't be opened elsewhere.
using System.Security.Cryptography;
using System.Text;
using Microsoft.Win32;

namespace IdCard.Desktop;

static class KeyStore
{
    const string RegPath = @"Software\ID Card Printing Software";
    const string RegName = "DatabaseKey";

    static string? Read()
    {
        using var k = Registry.CurrentUser.OpenSubKey(RegPath);
        if (k?.GetValue(RegName) is not string v || v.Length == 0) return null;
        return Encoding.ASCII.GetString(ProtectedData.Unprotect(Convert.FromBase64String(v), null, DataProtectionScope.CurrentUser));
    }

    public static string GetKey(bool allowCreate)
    {
        if (Read() is { } key) return key;
        if (!allowCreate) throw new InvalidOperationException("The database key for this Windows account was not found.");
        key = Convert.ToHexStringLower(RandomNumberGenerator.GetBytes(32));
        using (var k = Registry.CurrentUser.CreateSubKey(RegPath))
            k.SetValue(RegName, Convert.ToBase64String(ProtectedData.Protect(Encoding.ASCII.GetBytes(key), null, DataProtectionScope.CurrentUser)));
        // Read it back to prove it round-trips before any data is written with it.
        if (Read() != key) throw new InvalidOperationException("The database key could not be verified after saving.");
        return key;
    }
}
