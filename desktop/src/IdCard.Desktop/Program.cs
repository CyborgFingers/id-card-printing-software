// ID Card Printing Software Free - Copyright (c) 2026 Josh McNabb. All rights reserved. See LICENSE.txt.
// The Windows program: runs the print service, a notification-area icon and the app window. There is
// deliberately no Exit item: closing the window hides it (printing carries on), and the program is
// closed from Settings by an administrator. "--background" starts it without opening the window
// (used at sign-in). Every Windows account on the PC shares one database (DataDir), and one copy of the program runs
// the print service; a copy in another signed-in account opens its window onto that one.
using System.ComponentModel;
using System.Diagnostics;
using System.Reflection;
using System.Security.Principal;
using IdCard.Desktop.Printing;
using IdCard.Service;

namespace IdCard.Desktop;

static class Program
{
    internal const string Title = AppService.AppName;
    // One copy per Windows account in each Windows session (another account's copy can share a session, and its
    // names can't be opened by this account); one copy on the PC runs the print service.
    static readonly string Account = "." + WindowsIdentity.GetCurrent().User?.Value;
    static readonly string MutexName = @"Local\IDCardPrintingSoftwareFree.App" + Account;
    const string ServiceMutexName = @"Global\IDCardPrintingSoftwareFree.Service";
    static readonly string ShowEventName = @"Local\IDCardPrintingSoftwareFree.Show" + Account;
    static readonly string ExitEventName = @"Local\IDCardPrintingSoftwareFree.Exit" + Account;

    [STAThread]
    static int Main(string[] args)
    {
        if (args.Contains("--reset-admin", StringComparer.OrdinalIgnoreCase)) return ResetAdminSignIn();
        if (args.Contains("--exit", StringComparer.OrdinalIgnoreCase)) return ExitRunningCopy();
        var background = args.Contains("--background", StringComparer.OrdinalIgnoreCase);
        using var mutex = new Mutex(true, MutexName, out var first);
        if (!first)
        {
            // Already running: bring its window forward instead.
            if (!background && EventWaitHandle.TryOpenExisting(ShowEventName, out var show))
                using (show) { AllowSetForegroundWindow(-1); show.Set(); }
            return 0;
        }
        using var showEvent = new EventWaitHandle(false, EventResetMode.AutoReset, ShowEventName);
        using var exitEvent = new EventWaitHandle(false, EventResetMode.ManualReset, ExitEventName);
        using var serviceLock = TakeServiceLock();
        Application.SetHighDpiMode(HighDpiMode.PerMonitorV2);
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        Application.SetUnhandledExceptionMode(UnhandledExceptionMode.CatchException);
        Application.ThreadException += (_, e) => ShowError("Something went wrong.", e.Exception.Message);
        if (serviceLock is not null) BringOldData();
        Application.Run(new TrayApp(!background, serviceLock, showEvent, exitEvent));
        return 0;
    }

    [System.Runtime.InteropServices.DllImport("user32.dll")] static extern bool AllowSetForegroundWindow(int processId);

    /// <summary>Only the copy holding this lock runs the print service, so the PC has one print queue. Null when a copy
    /// in another Windows account (or session) holds it.</summary>
    internal static Mutex? TakeServiceLock()
    {
        Mutex m;
        try { m = new Mutex(true, ServiceMutexName, out var created); if (created) return m; }
        catch (UnauthorizedAccessException) { return null; }   // made by another Windows account
        try { if (m.WaitOne(0)) return m; }
        catch (AbandonedMutexException) { return m; }          // its copy ended without letting go: ours now
        m.Dispose();
        return null;
    }

    /// <summary>Up to 3.0.11 each Windows account had its own data: brings this account's into the shared folder (once).</summary>
    internal static void BringOldData()
    {
        if (!File.Exists(Path.Combine(UserDir, AppService.DbFileName))) return;
        try { if (KeyStore.OldKey() is { } key) MoveData.FromAccount(UserDir, key, DataDir, KeyStore.GetKey, UseAccountData); }
        catch (Exception e) { ShowError("Your earlier data could not be moved into the shared data folder.", e.Message + "\n\nNothing was deleted."); }
    }

    /// <summary>Asked once, when this Windows account's own older data and the shared data both have something in them.</summary>
    static bool UseAccountData(MoveData.Contents mine, MoveData.Contents shared) => Message(
        $"This Windows account ({Environment.UserName}) has its own data from an older version of the program: {mine}.\n\n" +
        $"Everyone on this PC now shares one set of data, which already has {shared}.\n\n" +
        "Use this account's data for everyone instead? Choose No to keep the shared data. The other copy is kept as a file on this PC.",
        MessageBoxButtons.YesNo, MessageBoxIcon.Question, MessageBoxDefaultButton.Button2) == DialogResult.Yes;

    internal static string Version =>
        (Assembly.GetExecutingAssembly().GetCustomAttribute<AssemblyInformationalVersionAttribute>()?.InformationalVersion ?? "3.0.0").Split('+')[0];

    internal static ServiceOptions Options(Action stopped, Action<string, string, bool> notify) => new()
    {
        DataDir = DataDir,
        UserDir = UserDir,
        WebRoot = Path.Combine(AppContext.BaseDirectory, "wwwroot"),
        GetDbKey = KeyStore.GetKey,
        KeyProtection = "Windows DPAPI, this PC only",
        RealPrinter = settings => new WindowsPrinter(settings),
        Port = ChosenPort,
        Version = Version,
#if DEBUG
        UpdateFeed = Environment.GetEnvironmentVariable("IDCARD_UPDATE_FEED") is { Length: > 0 } feed ? feed : AppService.DefaultUpdateFeed,   // testing only
#else
        UpdateFeed = AppService.DefaultUpdateFeed,
#endif
        RunInstaller = RunInstaller,
        Stopped = stopped,
        Notify = notify,
        LicenceAcceptedInSetup = true,   // the setup's licence page must be accepted to install
    };

    /// <summary>"--exit" (used by the uninstaller): asks a running copy to save and close, waiting up to 10 seconds.</summary>
    static int ExitRunningCopy()
    {
        if (!EventWaitHandle.TryOpenExisting(ExitEventName, out var exit)) return 0;   // not running
        using (exit) exit.Set();
        for (int i = 0; i < 100; i++)
        {
            if (!Mutex.TryOpenExisting(MutexName, out var m)) return 0;
            m.Dispose();
            Thread.Sleep(100);
        }
        return 1;
    }

    /// <summary>The data, shared by every Windows account on this PC (setup lets every account change it).</summary>
    internal static string DataDir => Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "ID Card Printing Software");
    /// <summary>This Windows account's own folder: its window's browser data and update downloads (and, up to 3.0.11, its data).</summary>
    internal static string UserDir => Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "ID Card Printing Software");

    static int? ChosenPort => int.TryParse(Environment.GetEnvironmentVariable("IDCARD_PORT"), out var port) ? port : null;
    /// <summary>Where the print service answers, for a copy that opens its window onto another account's service.</summary>
    internal static string ServiceUrl => $"http://localhost:{ChosenPort ?? 5180}";   // ponytail: the service's default port, which nothing changes

    /// <summary>"--reset-admin": the emergency sign-in reset. Every Windows account shares the data, so it needs a
    /// Windows administrator: otherwise it asks Windows to run it as one.</summary>
    static int ResetAdminSignIn()
    {
        Application.EnableVisualStyles();
        if (!new WindowsPrincipal(WindowsIdentity.GetCurrent()).IsInRole(WindowsBuiltInRole.Administrator))
        {
            try { using var p = Process.Start(new ProcessStartInfo(Environment.ProcessPath!, "--reset-admin") { UseShellExecute = true, Verb = "runas" }); return 0; }
            catch (Win32Exception e) when (e.NativeErrorCode == 1223) { return 1; }   // cancelled
            catch (Win32Exception e) { ShowError("The admin sign-in could not be reset.", e.Message); return 1; }
        }
        if (Message("Reset the admin sign-in to username admin and password admin?\n\nA new password must be chosen at the next sign-in.",
            MessageBoxButtons.OKCancel, MessageBoxIcon.Question) != DialogResult.OK) return 1;
        try { ResetAdmin.Run(DataDir, KeyStore.GetKey(false)); }
        catch (Exception e)
        {
            ShowError("The admin sign-in could not be reset.", e.Message);
            return 1;
        }
        Message("Done. Sign in with username admin and password admin, then choose a new password.\n\nIf sign-in is paused after too many wrong passwords, close and reopen the program.",
            MessageBoxButtons.OK, MessageBoxIcon.Information);
        return 0;
    }

    /// <summary>Starts the downloaded setup silently; Windows asks for permission because it installs for everyone.
    /// /UPDATE makes the setup open the program again when it's done.</summary>
    static string? RunInstaller(string setup)
    {
        try
        {
            using var p = Process.Start(new ProcessStartInfo(setup, "/VERYSILENT /SUPPRESSMSGBOXES /NORESTART /UPDATE") { UseShellExecute = true, Verb = "runas" });
            return null;
        }
        catch (Win32Exception e) when (e.NativeErrorCode == 1223) { return "The update was cancelled."; }
        catch (Win32Exception e) { return "The update could not start: " + e.Message; }
    }

    internal static void ShowError(string what, string details) => Message(what + Environment.NewLine + Environment.NewLine + details, MessageBoxButtons.OK, MessageBoxIcon.Error);

    /// <summary>A message that opens in front of other windows (at sign-in, from the notification area or a
    /// shortcut, Windows may not give this program the foreground).</summary>
    static DialogResult Message(string text, MessageBoxButtons buttons, MessageBoxIcon icon, MessageBoxDefaultButton defaultButton = MessageBoxDefaultButton.Button1)
    {
        using var owner = new Form { TopMost = true, ShowInTaskbar = false, FormBorderStyle = FormBorderStyle.None, Opacity = 0, Size = new Size(1, 1), StartPosition = FormStartPosition.CenterScreen };
        owner.Show();
        owner.Activate();
        return MessageBox.Show(owner, text, Title, buttons, icon, defaultButton);
    }
}
