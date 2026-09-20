#requires -version 7
# 负向流程：激活码被吊销 / 已过期 / 已经绑到别的电脑之后，客户端重新启动应该
#   1) 仍然停在激活页，输入框里还留着原来的激活码（不清空）
#   2) 不主动弹提示，只有点了“登录”才弹对应提示
#
# 每个场景都走真实界面：先在这台机器上正常激活成功，再让这张授权在后台失效，
# 直接结束客户端（localStorage 很可能还没落盘，顺便验证代理兜底），
# 重新启动 -> 截图 -> 点登录 -> 截图。
param(
    [ValidateSet('revoked', 'expired', 'mismatch')][string]$Scenario = 'revoked',
    [string]$Dir = 'E:\GPT Codex\2026-09-15\new-chat\work\rebrand\shots\app',
    [string]$ShotDir = 'E:\GPT Codex\2026-09-15\new-chat\work\rebrand\probe',
    [string]$WebDir = 'E:\GPT Codex\2026-09-15\new-chat\outputs\videomix-web',
    [string]$DataDir = 'E:\GPT Codex\2026-09-15\new-chat\work\rebrand\probe\data',
    [string]$SignKey = 'E:\GPT Codex\2026-09-15\new-chat\work\videomix-rebuild\keys\license-private.xml',
    [int]$Port = 8082,
    [switch]$KeepOpen
)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$env:PYTHONIOENCODING = 'utf-8'

$py = 'C:\Users\Administrator\AppData\Local\Programs\Python\Python312\python.exe'
$base = "http://127.0.0.1:$Port"
$ticketFile = Join-Path $Dir 'license-ticket.json'

Add-Type -AssemblyName System.Drawing
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class UiHelp3 {
    [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
    [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint dx, uint dy, uint d, UIntPtr e);
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT6 r);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
}
public struct RECT6 { public int Left, Top, Right, Bottom; }
'@

function Stop-Clients {
    foreach ($name in @('videomix', 'KrLongAI', 'VideoMix')) {
        Get-Process $name -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
    }
    Start-Sleep -Seconds 2
}

function Get-ClientWindow {
    Get-Process videomix -ErrorAction SilentlyContinue |
        Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
}

function Get-WindowBox($window) {
    $rect = New-Object RECT6
    [void][UiHelp3]::GetWindowRect($window.MainWindowHandle, [ref]$rect)
    return $rect
}

function Click-At([int]$x, [int]$y) {
    [void][UiHelp3]::SetCursorPos($x, $y)
    Start-Sleep -Milliseconds 250
    [UiHelp3]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero)
    [UiHelp3]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)
    Start-Sleep -Milliseconds 250
}

function Save-Shot($window, [string]$path) {
    [void][UiHelp3]::SetForegroundWindow($window.MainWindowHandle)
    Start-Sleep -Milliseconds 900
    $rect = Get-WindowBox $window
    $w = $rect.Right - $rect.Left
    $h = $rect.Bottom - $rect.Top
    $bmp = New-Object System.Drawing.Bitmap($w, $h)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.CopyFromScreen($rect.Left, $rect.Top, 0, 0, $bmp.Size)
    New-Item -ItemType Directory -Force -Path (Split-Path $path) | Out-Null
    $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
    $g.Dispose(); $bmp.Dispose()
    Write-Output ("  截图 {0}" -f $path)
}

function Wait-Window([int]$tries = 120) {
    for ($i = 0; $i -lt $tries; $i++) {
        Start-Sleep -Milliseconds 500
        $w = Get-ClientWindow
        if ($w) { return $w }
    }
    throw '等不到客户端窗口'
}

function Start-Client { $null = Start-Process -FilePath (Join-Path $Dir 'VideoMix.exe') -WorkingDirectory $Dir -PassThru }

function Api {
    param($Method, $Path, $Body, $Session)
    $q = @{ Uri = "$base$Path"; Method = $Method; NoProxy = $true; SkipHttpErrorCheck = $true }
    if ($Session) { $q.WebSession = $Session }
    if ($null -ne $Body) { $q.ContentType = 'application/json'; $q.Body = ($Body | ConvertTo-Json -Depth 6 -Compress) }
    (Invoke-WebRequest @q).Content | ConvertFrom-Json
}

function Show-ProxyLicense {
    try {
        $lic = Invoke-RestMethod 'http://127.0.0.1:8081/vm/license' -NoProxy -TimeoutSec 5
        Write-Output ("  本机代理手里的激活码：{0}" -f $lic.data.activateCode)
    } catch {
        Write-Output ("  本机代理没给出激活码：{0}" -f $_.Exception.Message)
    }
}

$label = @{ revoked = '吊销'; expired = '过期'; mismatch = '换电脑' }[$Scenario]
Write-Output ("=== 场景：{0} ===" -f $label)

Stop-Clients
Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
    Select-Object -First 1 -ExpandProperty OwningProcess |
    ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }
Start-Sleep -Milliseconds 500

Write-Output '--- 启动测试后台 ---'
New-Item -ItemType Directory -Force -Path $DataDir | Out-Null
$web = Start-Process -FilePath $py `
    -ArgumentList @('server.py', '--host', '127.0.0.1', '--port', "$Port", '--data-dir', "`"$DataDir`"", '--signing-key', "`"$SignKey`"") `
    -WorkingDirectory $WebDir -PassThru -WindowStyle Hidden `
    -RedirectStandardOutput (Join-Path $DataDir 'out.log') -RedirectStandardError (Join-Path $DataDir 'err.log')
for ($i = 0; $i -lt 40; $i++) {
    Start-Sleep -Milliseconds 250
    try { if ((Invoke-RestMethod "$base/health" -NoProxy -TimeoutSec 3).ok) { break } } catch { }
}

$session = New-Object Microsoft.PowerShell.Commands.WebRequestSession
$null = Api POST '/api/login' @{ username = 'admin'; password = 'admin123' } $session
$batch = Api POST '/api/batches' @{ name = "负向-${Scenario}"; quantity = 1; days = 365; maxDevices = 1 } $session
$row = (Api GET "/api/codes?batchId=$($batch.id)" $null $session).data[0]
$code = $row.code
$codeId = $row.id
Write-Output ("  激活码：{0}（id={1}）" -f $code, $codeId)

$local = @{ serverUrl = $base } | ConvertTo-Json -Compress
[System.IO.File]::WriteAllText((Join-Path $Dir 'license-server.json'), $local,
    (New-Object System.Text.UTF8Encoding($false)))
if (Test-Path -LiteralPath $ticketFile) { Remove-Item -LiteralPath $ticketFile -Force }

Write-Output '--- 清掉上一轮留下的激活码（只删激活码与会话令牌两个键）---'
$debugPort = 9223
$null = Start-Process -FilePath (Join-Path $Dir 'videomix\videomix.exe') `
    -ArgumentList "--remote-debugging-port=$debugPort" -WorkingDirectory (Join-Path $Dir 'videomix') -PassThru
$cdpReady = $false
for ($i = 0; $i -lt 80; $i++) {
    Start-Sleep -Milliseconds 500
    try {
        if (Invoke-RestMethod "http://127.0.0.1:$debugPort/json/list" -NoProxy -TimeoutSec 3) { $cdpReady = $true; break }
    } catch { }
}
if ($cdpReady) {
    Start-Sleep -Seconds 3
    $env:VM_CDP_PORT = "$debugPort"
    & $py 'E:\GPT Codex\2026-09-15\new-chat\work\rebrand\probe\clear-code.py'
} else {
    Write-Output '  调试端口没起来，跳过（激活码可能还是上一轮的）'
}
Stop-Clients

Write-Output '--- 先用真实界面激活一次 ---'
$shell = New-Object -ComObject WScript.Shell
Start-Client
$window = Wait-Window
Start-Sleep -Seconds 9
$null = $shell.AppActivate($window.Id)
Start-Sleep -Milliseconds 900

$box = Get-WindowBox $window
Click-At ($box.Left + [int](($box.Right - $box.Left) * 0.5)) ($box.Top + [int](($box.Bottom - $box.Top) * 0.535))
Start-Sleep -Milliseconds 400
$shell.SendKeys('^a'); Start-Sleep -Milliseconds 200
$shell.SendKeys('{DEL}'); Start-Sleep -Milliseconds 200
Set-Clipboard -Value $code; Start-Sleep -Milliseconds 200
$shell.SendKeys('^v'); Start-Sleep -Milliseconds 800
Click-At ($box.Left + [int](($box.Right - $box.Left) * 0.5)) ($box.Top + [int](($box.Bottom - $box.Top) * 0.618))

$activated = $false
for ($i = 0; $i -lt 40; $i++) {
    Start-Sleep -Seconds 1
    if (Test-Path -LiteralPath $ticketFile) { $activated = $true; break }
}
Write-Output ("  激活票据已落地：{0}" -f $activated)
if (-not $activated) { Write-Output '  激活没成功，后面的结论不可信' }
Start-Sleep -Seconds 6
$window.Refresh()
Write-Output ("  激活后窗口标题：{0}" -f $window.MainWindowTitle)
Save-Shot $window (Join-Path $ShotDir "neg-$Scenario-1-激活成功.png")

Write-Output '--- 在后台让这张授权失效 ---'
switch ($Scenario) {
    'revoked' {
        $null = Api POST "/api/codes/$codeId/revoke" @{} $session
        Write-Output '  已在后台吊销'
    }
    'expired' {
        $env:NEG_CODE_ID = "$codeId"
        $env:NEG_DB = (Join-Path $DataDir 'license.db')
        & $py -c "import os,sqlite3,datetime; c=sqlite3.connect(os.environ['NEG_DB']); c.execute('UPDATE codes SET expires_at=? WHERE id=?', ((datetime.datetime.now(datetime.timezone.utc)-datetime.timedelta(days=1)).isoformat(), int(os.environ['NEG_CODE_ID']))); c.commit(); print('  已把 expires_at 改到昨天，改动行数', c.total_changes)"
    }
    'mismatch' {
        $devices = (Api GET "/api/codes/$codeId/devices" $null $session).data
        foreach ($device in $devices) {
            # 后台返回的是数据库列名（device_id），不是驼峰
            $fp = $device.device_id
            if (-not $fp) { $fp = $device.deviceId }
            if (-not $fp) { Write-Output '  没读到设备号，跳过解绑'; continue }
            $null = Api POST "/api/codes/$codeId/devices/$([uri]::EscapeDataString($fp))/unbind" @{} $session
            Write-Output ("  已解绑本机设备 {0}" -f $fp)
        }
        $body = @{ activateCode = $code; deviceId = 'OTHER-PC-8899'; category = 2 } | ConvertTo-Json -Compress
        $rpc = Invoke-RestMethod -Uri "$base/rpc/authActivateCode" -Method Post -NoProxy -ContentType 'application/json' -Body $body -TimeoutSec 20
        Write-Output ("  已把这张码绑到别的电脑：object={0} message={1}" -f $rpc.object, $rpc.message)
    }
}

Write-Output '--- 结束客户端（模拟用户直接关掉，localStorage 很可能还没落盘）---'
Stop-Clients

Write-Output '--- 重新启动，观察输入框 ---'
Start-Client
$window = Wait-Window
Start-Sleep -Seconds 35
$window.Refresh()
Write-Output ("  重启后窗口标题：{0}" -f $window.MainWindowTitle)
$box = Get-WindowBox $window
Save-Shot $window (Join-Path $ShotDir "neg-$Scenario-2-重启后-掩码.png")
Click-At ($box.Left + [int](($box.Right - $box.Left) * 0.601)) ($box.Top + [int](($box.Bottom - $box.Top) * 0.541))
Start-Sleep -Milliseconds 800
Save-Shot $window (Join-Path $ShotDir "neg-$Scenario-2b-重启后-明文.png")
Show-ProxyLicense

Write-Output '--- 点一次“登录”，看提示 ---'
Click-At ($box.Left + [int](($box.Right - $box.Left) * 0.5)) ($box.Top + [int](($box.Bottom - $box.Top) * 0.618))
foreach ($delay in @(1, 3, 6)) {
    Start-Sleep -Seconds $delay
    Save-Shot $window (Join-Path $ShotDir "neg-$Scenario-3-点登录后-${delay}s.png")
}

if (-not $KeepOpen) {
    Stop-Clients
    if ($web -and -not $web.HasExited) { Stop-Process -Id $web.Id -Force -ErrorAction SilentlyContinue }
}
Write-Output '完成'
