#requires -version 7
# 验证换品牌之后的安装包：装一遍、跑起来、激活、并检查各处品牌名是否真的换了。
param(
    [Parameter(Mandatory = $true)][string]$Setup,
    [string]$BrandConfig = 'E:\GPT Codex\2026-09-15\new-chat\work\rebrand\brand.json',
    [string]$Scratch = 'E:\GPT Codex\2026-09-15\new-chat\work\rebrand\verify',
    [string]$WebDir = 'E:\GPT Codex\2026-09-15\new-chat\outputs\videomix-web',
    [string]$SignKey = 'E:\GPT Codex\2026-09-15\new-chat\work\videomix-rebuild\keys\license-private.xml',
    [int]$Port = 8082
)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$env:PYTHONIOENCODING = 'utf-8'

$py = 'C:\Users\Administrator\AppData\Local\Programs\Python\Python312\python.exe'
$patchExe = 'E:\GPT Codex\2026-09-15\new-chat\work\rebrand\patch_exe.py'
$brand = Get-Content -LiteralPath $BrandConfig -Raw -Encoding UTF8 | ConvertFrom-Json
$displayName = if ($brand.displayName) { $brand.displayName } else { "$($brand.slug) $($brand.name)" }

$stageDir = Join-Path $Scratch 'stage'
$installDir = Join-Path $Scratch 'app'
$dataDir = Join-Path $Scratch 'data'
$base = "http://127.0.0.1:$Port"
$proxy = 'http://127.0.0.1:8081'
$pass = 0
$fail = 0

function Check([string]$name, [string]$expected, [string]$actual) {
    if ($expected -eq $actual) { Write-Output ("PASS  {0}  -> {1}" -f $name, $actual); $script:pass++ }
    else { Write-Output ("FAIL  {0}  期望={1} 实际={2}" -f $name, $expected, $actual); $script:fail++ }
}
function CheckContains([string]$name, [string]$needle, [string]$haystack) {
    Check $name 'True' ([string]($haystack -like "*$needle*"))
}
function Api {
    param($Method, $Path, $Body, $Session)
    $q = @{ Uri = "$base$Path"; Method = $Method; NoProxy = $true; SkipHttpErrorCheck = $true }
    if ($Session) { $q.WebSession = $Session }
    if ($null -ne $Body) { $q.ContentType = 'application/json'; $q.Body = ($Body | ConvertTo-Json -Depth 6 -Compress) }
    (Invoke-WebRequest @q).Content | ConvertFrom-Json
}

foreach ($p in @('videomix', 'KrLongAI', 'VideoMix')) {
    Get-Process $p -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
}
Start-Sleep -Milliseconds 800
if (Test-Path -LiteralPath $Scratch) { [System.IO.Directory]::Delete($Scratch, $true) }
New-Item -ItemType Directory -Path $stageDir, $installDir, $dataDir -Force | Out-Null
Copy-Item -LiteralPath $Setup -Destination (Join-Path $stageDir 'setup.exe') -Force

Write-Output '--- 启动测试后台 ---'
$web = Start-Process -FilePath $py `
    -ArgumentList @('server.py', '--host', '127.0.0.1', '--port', "$Port", '--data-dir', "`"$dataDir`"", '--signing-key', "`"$SignKey`"") `
    -WorkingDirectory $WebDir -PassThru -WindowStyle Hidden `
    -RedirectStandardOutput (Join-Path $dataDir 'out.log') -RedirectStandardError (Join-Path $dataDir 'err.log')
$ready = $false
for ($i = 0; $i -lt 40; $i++) {
    Start-Sleep -Milliseconds 250
    try { $h = Invoke-RestMethod "$base/health" -NoProxy -TimeoutSec 3; if ($h.ok) { $ready = $true; break } } catch { }
}
Check '测试后台已启动' 'True' ([string]$ready)

$session = New-Object Microsoft.PowerShell.Commands.WebRequestSession
$null = Api POST '/api/login' @{ username = 'admin'; password = 'admin123' } $session
$batch = Api POST '/api/batches' @{ name = '换品牌验证'; quantity = 1; days = 365; maxDevices = 1 } $session
$code = (Api GET "/api/codes?batchId=$($batch.id)" $null $session).data[0].code

Write-Output ''
Write-Output '--- 静默安装 ---'
@(('dir=' + $installDir), 'desktop=0', 'launch=0') |
    Set-Content -LiteralPath (Join-Path $stageDir 'setup.ini') -Encoding UTF8
$install = Start-Process -FilePath (Join-Path $stageDir 'setup.exe') -ArgumentList '/S' -Wait -PassThru
Check '安装程序退出码' '0' ([string]$install.ExitCode)
Check '安装目录里有启动器' 'True' ([string](Test-Path -LiteralPath (Join-Path $installDir 'VideoMix.exe')))
Check '安装目录里有主程序' 'True' ([string](Test-Path -LiteralPath (Join-Path $installDir 'videomix\videomix.exe')))

Write-Output ''
Write-Output '--- 品牌信息 ---'
$usage = Get-Content -LiteralPath (Join-Path $installDir '使用说明.txt') -Raw -Encoding UTF8
CheckContains '使用说明里有新名字' $displayName $usage

$props = & $py $patchExe --show (Join-Path $installDir 'videomix\videomix.exe')
$propsText = $props -join "`n"
CheckContains 'exe 文件属性里的产品名' $displayName $propsText
CheckContains 'exe 文件属性里的公司名' $brand.company $propsText
CheckContains 'exe 文件属性里的版权' $brand.copyright $propsText

$setupInfo = (Get-Item -LiteralPath (Join-Path $stageDir 'setup.exe')).VersionInfo
Check '安装包属性里的产品名' $displayName ([string]$setupInfo.ProductName)
Check '安装包属性里的公司名' $brand.company ([string]$setupInfo.CompanyName)
Check '安装包属性里的版权' $brand.copyright ([string]$setupInfo.LegalCopyright)

$uninstallKey = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\$($brand.slug)"
$display = (Get-ItemProperty -LiteralPath $uninstallKey -ErrorAction SilentlyContinue).DisplayName
Check '控制面板显示名' $displayName ([string]$display)

$asarCheck = & $py 'E:\GPT Codex\2026-09-15\new-chat\work\rebrand\check_asar_title.py' `
    (Join-Path $installDir 'videomix\resources\app.asar') $brand.name
$asarCheck | ForEach-Object { Write-Output ("      " + $_) }
Check 'asar 界面标题已换' '0' ([string]$LASTEXITCODE)

# 行为补丁：装出来的副本也要带着这两条，否则“重启停在激活页 + 激活码自动带出”就不成立。
$grepAsar = 'E:\GPT Codex\2026-09-15\new-chat\work\rebrand\grep-asar.py'
$installedAsar = Join-Path $installDir 'videomix\resources\app.asar'
function CountInAsar([string]$needle) {
    $out = & $py $grepAsar $needle 200 $installedAsar 2>&1
    $last = ($out | Where-Object { $_ -like 'hits *' } | Select-Object -Last 1)
    if (-not $last) { return -1 }
    return [int]($last -replace '^hits\s+', '')
}
# 注意：`localStorage.removeItem(er)` 这个片段原版里本来就有（rr() 里那句），
# 必须连前面的函数头一起匹配才是我们插进去的那条。
Check 'asar 里保留激活码、只清会话令牌' '1' `
    ([string](CountInAsar 'function ro(e){no(e)}try{localStorage.removeItem(er)}catch{}'))
Check 'asar 里激活页会问本机代理要激活码' '1' ([string](CountInAsar 'http://127.0.0.1:8081/vm/license'))

# 界面微调补丁（work\rebrand\ui_rules.py）：logo 留白 + 滚动收进内容区、标题栏固定。
$ui = & $py 'E:\GPT Codex\2026-09-15\new-chat\work\rebrand\ui-strings.py' | ConvertFrom-Json
Check 'asar 里侧栏 logo 已缩小留白' '1' ([string](CountInAsar $ui.LOGO_NEW))
Check 'asar 里滚动已收进内容区' '1' ([string](CountInAsar $ui.LAYOUT_NEW))
Check 'asar 里旧的整页滚动样式已清除' '0' ([string](CountInAsar $ui.LAYOUT_OLD))

# 镜头空档补丁（work\rebrand\gap_rules.py）：没人说话的镜头不再播完整段素材，
# 合成前先弹一次提醒（阈值 0.5 秒）。
$gap = & $py 'E:\GPT Codex\2026-09-15\new-chat\work\rebrand\gap-strings.py' | ConvertFrom-Json
Check 'asar 里空档阈值是 0.5 秒' '1' ([string](CountInAsar 'var VmxGap=0.5,VmxCps=4.5;'))
Check 'asar 里有合成前提醒（VmxCheck）' '1' ([string](CountInAsar $gap.BT_NEW))
Check 'asar 里没配音的镜头会按文案裁短' '1' ([string](CountInAsar $gap.ELSE_NEW))
Check 'asar 里旧的“播完整段素材”分支已清除' '0' ([string](CountInAsar $gap.ELSE_OLD))

# 账号档案的 AI 补丁（work\rebrand\persona_rules.py）：加「AI 帮我写」，
# 问答式生成整份档案，走系统设置里已有的阿里云百炼 Key。
$persona = & $py 'E:\GPT Codex\2026-09-15\new-chat\work\rebrand\persona-strings.py' | ConvertFrom-Json
Check 'asar 里账号档案有「AI 帮我写」按钮' '1' ([string](CountInAsar $persona.BTN_NEW))
Check 'asar 里引进了百炼对话接口' '1' ([string](CountInAsar $persona.IMPORT_NEW))
Check 'asar 里有 AI 问答生成档案的逻辑' '1' ([string](CountInAsar $persona.PROMPT_FN))
# 这个串出现两次：对话框模板里一次，读它勾没勾的一次。
Check 'asar 里有「覆盖已填内容」开关' '2' ([string](CountInAsar $persona.COVER))

# 系统预设的示例档案（work\rebrand\persona_seed_rules.py）：新装的软件打开「账号档案」，
# 里面已经是一份写满的示例档案（北京烤鸭店的李逍遥）；旧的“红姐 / 鸭血粉丝汤”示例不再出现。
# 这个串出现 2 次：mix 里生成默认档案一次，账号档案页判断“客户改没改过”一次。
Check 'asar 里有系统预设示例档案' '2' ([string](CountInAsar $persona.STOCK_MARK))
Check 'asar 里旧的默认档案逻辑已替换' '0' ([string](CountInAsar $persona.SEED_OLD))
Check 'asar 里旧的红姐示例已清除' '0' ([string](CountInAsar $persona.OLD_EXAMPLE))
Check 'asar 里旧的档案名示例已清除' '0' ([string](CountInAsar $persona.OLD_NAME_PH))
# 表单里去掉了「出生年份」「性别」两格，改写参考也不再输出这两项。
Check 'asar 里档案表单已去掉出生年份' '0' ([string](CountInAsar $persona.NO_AGE))
Check 'asar 里档案表单已去掉性别' '0' ([string](CountInAsar $persona.NO_GENDER))
Check 'asar 里改写参考不再带年龄性别' '0' ([string](CountInAsar $persona.REF_OLD))
# 点「新建」建完档案之后直接弹「AI 帮我写」。
Check 'asar 里新建档案会自动弹 AI' '1' ([string](CountInAsar $persona.NEW_PROFILE_HOOK))

# 智能配音补丁（work\rebrand\voice_rules.py）：没填 MiniMax Key 时，音色下拉要能点开、
# 里面放 9 个内置默认音色，并且点「创建任务」先弹二次确认框（立即配置 / 继续生成）。
# '未填写 MiniMax Key' 出现 2 次：下拉框占位 1 次 + 提示 1 次。
$voice = & $py 'E:\GPT Codex\2026-09-15\new-chat\work\rebrand\voice-strings.py' | ConvertFrom-Json
Check 'asar 里音色下拉会写明缺 MiniMax Key' '2' ([string](CountInAsar '未填写 MiniMax Key'))
Check 'asar 里音色下拉没 Key 也能点开' '1' ([string](CountInAsar $voice.DROPDOWN_NEW))
Check 'asar 里没了旧的“选择音色”写死占位' '0' ([string](CountInAsar $voice.PLACEHOLDER_OLD))
Check 'asar 里没了旧的“灰掉不给点”逻辑' '0' ([string](CountInAsar $voice.DISABLED_OLD))
Check 'asar 里没 Key 时下拉有内置音色清单' '1' ([string](CountInAsar $voice.FALLBACK_JS))
Check 'asar 里内置音色清单对得上默认音色表' '1' ([string](CountInAsar '清亮女主播'))
Check 'asar 里有可点去系统设置的提示' '1' ([string](CountInAsar $voice.HINT_TEXT))
Check 'asar 里旧的音色提示已换掉' '0' ([string](CountInAsar $voice.HINT_TEXT_OLD))
Check 'asar 里创建任务会先弹二次确认' '1' ([string](CountInAsar '未配置 MiniMax'))
Check 'asar 里二次确认有「立即配置 / 继续生成」两个按钮' '1' `
    ([string](CountInAsar 'confirmButtonText:`继续生成`,cancelButtonText:`立即配置`'))

Write-Output '--- 把客户端指回测试后台 ---'
$local = @{ serverUrl = $base } | ConvertTo-Json -Compress
[System.IO.File]::WriteAllText((Join-Path $installDir 'license-server.json'), $local,
    (New-Object System.Text.UTF8Encoding($false)))
Check '测试地址已写入' $base ((Get-Content -Raw -LiteralPath (Join-Path $installDir 'license-server.json') | ConvertFrom-Json).serverUrl)

Write-Output ''
Write-Output '--- 启动客户端并激活 ---'
$client = Start-Process -FilePath (Join-Path $installDir 'VideoMix.exe') -PassThru
$up = $false
for ($i = 0; $i -lt 60; $i++) {
    Start-Sleep -Seconds 1
    try { $null = Invoke-RestMethod "$proxy/health" -NoProxy -TimeoutSec 3; $up = $true; break } catch { }
}
Check '客户端本地代理 8081' 'True' ([string]$up)

$title = ''
for ($i = 0; $i -lt 40; $i++) {
    Start-Sleep -Seconds 1
    $title = (Get-Process videomix -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle } | Select-Object -First 1).MainWindowTitle
    if ($title) { break }
}
CheckContains '窗口标题带新名字' $brand.name ([string]$title)

$body = '{"activateCode":"' + $code + '","deviceId":"REBRAND-0001","category":2}'
$rpc = Invoke-RestMethod -Uri "$proxy/rpc/authActivateCode" -Method Post -ContentType 'application/json' -Body $body -TimeoutSec 20 -NoProxy
Check '激活成功' 'SC' ([string]$rpc.object)

Write-Output ''
foreach ($p in @('videomix', 'KrLongAI', 'VideoMix')) {
    Get-Process $p -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
}
if ($web -and -not $web.HasExited) { Stop-Process -Id $web.Id -Force -ErrorAction SilentlyContinue }
Write-Output ("RESULT pass={0} fail={1}" -f $pass, $fail)
if ($fail -gt 0) { exit 1 }
