// ID Card Printing Software Free - Copyright (c) 2026 Josh McNabb. All rights reserved. See LICENSE.txt.
// Sign-in password hashes: scrypt, stored as "scrypt$N$r$p$salt$hash" (the format 2.x wrote, so
// existing accounts keep working). .NET has PBKDF2 but no scrypt, so the scrypt core (RFC 7914) is here.
using System.Buffers.Binary;
using System.Security.Cryptography;
using System.Text;

namespace IdCard.Security;

public static class Passwords
{
    const int N = 16384, R = 8, P = 1, KeyLength = 64;

    public static string Hash(string password)
    {
        var salt = RandomNumberGenerator.GetBytes(16);
        var h = Scrypt(Encoding.UTF8.GetBytes(password), salt, N, R, P, KeyLength);
        return $"scrypt${N}${R}${P}${Convert.ToBase64String(salt)}${Convert.ToBase64String(h)}";
    }

    public static bool Verify(string password, string? stored)
    {
        try
        {
            var p = (stored ?? "").Split('$');
            if (p.Length != 6 || p[0] != "scrypt") return false;
            int n = int.Parse(p[1]), r = int.Parse(p[2]), par = int.Parse(p[3]);
            if (n < 2 || (n & (n - 1)) != 0 || n > 1 << 20 || r < 1 || r > 32 || par < 1 || par > 16) return false;   // refuse silly costs
            var want = Convert.FromBase64String(p[5]);
            var got = Scrypt(Encoding.UTF8.GetBytes(password), Convert.FromBase64String(p[4]), n, r, par, want.Length);
            return CryptographicOperations.FixedTimeEquals(got, want);
        }
        catch (FormatException) { return false; }
    }

    internal static byte[] Scrypt(byte[] password, byte[] salt, int n, int r, int p, int dkLen)
    {
        int blockBytes = 128 * r, words = 32 * r;
        var b = Rfc2898DeriveBytes.Pbkdf2(password, salt, 1, HashAlgorithmName.SHA256, p * blockBytes);
        var x = new uint[words]; var y = new uint[words]; var v = new uint[words * n];
        for (int i = 0; i < p; i++)
        {
            var block = b.AsSpan(i * blockBytes, blockBytes);
            for (int k = 0; k < words; k++) x[k] = BinaryPrimitives.ReadUInt32LittleEndian(block[(k * 4)..]);
            for (int k = 0; k < n; k++) { Array.Copy(x, 0, v, k * words, words); BlockMix(x, y, r); }
            for (int k = 0; k < n; k++)
            {
                int j = (int)(x[(2 * r - 1) * 16] & (uint)(n - 1));
                for (int w = 0; w < words; w++) x[w] ^= v[j * words + w];
                BlockMix(x, y, r);
            }
            for (int k = 0; k < words; k++) BinaryPrimitives.WriteUInt32LittleEndian(block[(k * 4)..], x[k]);
        }
        Array.Clear(v);
        return Rfc2898DeriveBytes.Pbkdf2(password, b, 1, HashAlgorithmName.SHA256, dkLen);
    }

    /// <summary>scryptBlockMix: b becomes Y[0], Y[2], ... Y[1], Y[3], ... (y is scratch).</summary>
    static void BlockMix(uint[] b, uint[] y, int r)
    {
        Span<uint> t = stackalloc uint[16];
        b.AsSpan((2 * r - 1) * 16, 16).CopyTo(t);
        for (int i = 0; i < 2 * r; i++)
        {
            for (int k = 0; k < 16; k++) t[k] ^= b[i * 16 + k];
            Salsa208(t);
            t.CopyTo(y.AsSpan((i / 2 + (i % 2) * r) * 16, 16));
        }
        Array.Copy(y, b, 32 * r);
    }

    static void Salsa208(Span<uint> b)
    {
        Span<uint> x = stackalloc uint[16];
        b.CopyTo(x);
        for (int i = 0; i < 8; i += 2)
        {
            x[4] ^= uint.RotateLeft(x[0] + x[12], 7); x[8] ^= uint.RotateLeft(x[4] + x[0], 9);
            x[12] ^= uint.RotateLeft(x[8] + x[4], 13); x[0] ^= uint.RotateLeft(x[12] + x[8], 18);
            x[9] ^= uint.RotateLeft(x[5] + x[1], 7); x[13] ^= uint.RotateLeft(x[9] + x[5], 9);
            x[1] ^= uint.RotateLeft(x[13] + x[9], 13); x[5] ^= uint.RotateLeft(x[1] + x[13], 18);
            x[14] ^= uint.RotateLeft(x[10] + x[6], 7); x[2] ^= uint.RotateLeft(x[14] + x[10], 9);
            x[6] ^= uint.RotateLeft(x[2] + x[14], 13); x[10] ^= uint.RotateLeft(x[6] + x[2], 18);
            x[3] ^= uint.RotateLeft(x[15] + x[11], 7); x[7] ^= uint.RotateLeft(x[3] + x[15], 9);
            x[11] ^= uint.RotateLeft(x[7] + x[3], 13); x[15] ^= uint.RotateLeft(x[11] + x[7], 18);
            x[1] ^= uint.RotateLeft(x[0] + x[3], 7); x[2] ^= uint.RotateLeft(x[1] + x[0], 9);
            x[3] ^= uint.RotateLeft(x[2] + x[1], 13); x[0] ^= uint.RotateLeft(x[3] + x[2], 18);
            x[6] ^= uint.RotateLeft(x[5] + x[4], 7); x[7] ^= uint.RotateLeft(x[6] + x[5], 9);
            x[4] ^= uint.RotateLeft(x[7] + x[6], 13); x[5] ^= uint.RotateLeft(x[4] + x[7], 18);
            x[11] ^= uint.RotateLeft(x[10] + x[9], 7); x[8] ^= uint.RotateLeft(x[11] + x[10], 9);
            x[9] ^= uint.RotateLeft(x[8] + x[11], 13); x[10] ^= uint.RotateLeft(x[9] + x[8], 18);
            x[12] ^= uint.RotateLeft(x[15] + x[14], 7); x[13] ^= uint.RotateLeft(x[12] + x[15], 9);
            x[14] ^= uint.RotateLeft(x[13] + x[12], 13); x[15] ^= uint.RotateLeft(x[14] + x[13], 18);
        }
        for (int i = 0; i < 16; i++) b[i] += x[i];
    }
}
