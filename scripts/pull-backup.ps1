<#
.SYNOPSIS
  把服务器上最新一份备份拉回这台 Windows 电脑，作为异地副本。

.DESCRIPTION
  服务器每天 03:20 用 scripts/backup.sh 备份到 /opt/keticompass-backups，但那是同一台机器：
  硬盘坏了、云账号出了事，库和备份一起没（2026-09-25 评审第 5 条）。
  这个脚本每天拉最新一份回本机，逐个文件核对字节数，本机滚动保留 30 份。

  用 Windows 计划任务每天跑一次，注册命令见 docs/deploy.md「异地备份」。
  「开始时间已过就在下次开机时补跑」要在计划任务里勾上，电脑关着的那天才不会白白跳过。

  退出码：0 成功（含「已是最新」）；1 失败；2 拉取成功，但服务器最新一份已经超过 36 小时——
  说明服务器那边的备份自己停了，去看 /var/log/keticompass-backup.log。
  结果同时追加进本机备份目录下的 pull.log。

  注意：这份文件必须存成「UTF-8 带 BOM」。Windows PowerShell 5.1 读不带 BOM 的 UTF-8
  会把中文当成本地代码页解析，字符串全乱。

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File scripts\pull-backup.ps1
#>
param(
  # 不写死服务器和密钥：默认从本仓库的 git 配置里读——部署本来就靠 `server` 这个 remote
  # 和 core.sshCommand 里的 -i 密钥，两处各存一份早晚对不上。开源导出的敏感词扫描也因此过得去
  [string]$Server = "",
  [string]$KeyPath = "",
  [string]$RemoteDir = "/opt/keticompass-backups",
  [string]$LocalDir = (Join-Path $env:USERPROFILE "教师中台备份"),
  [int]$Keep = 30,
  [int]$StaleHours = 36
)

$ErrorActionPreference = "Stop"
# 备份目录名就是时间戳（服务器本地时间，东八区），和 backup.sh 的滚动清理同一个正则
$stampPattern = '^\d{4}-\d{2}-\d{2}_\d{4}$'

New-Item -ItemType Directory -Force -Path $LocalDir | Out-Null
$logPath = Join-Path $LocalDir "pull.log"

function Write-Log([string]$message) {
  $line = "[{0}] {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $message
  Write-Output $line
  Add-Content -Path $logPath -Value $line -Encoding UTF8
}

$exitCode = 0
try {
  $repoRoot = Split-Path -Parent $PSScriptRoot
  if (-not $Server) {
    $remoteUrl = & git -C $repoRoot remote get-url server 2>$null
    if ("$remoteUrl" -match '^([^:]+):') { $Server = $Matches[1] }
  }
  if (-not $KeyPath) {
    $sshCommand = & git -C $repoRoot config --get core.sshCommand 2>$null
    if ("$sshCommand" -match '-i\s+(\S+)') { $KeyPath = $Matches[1] -replace '^~', $env:USERPROFILE }
  }
  if (-not $Server) { throw "不知道服务器是哪台：仓库里没有 server 这个 git remote，用 -Server 指定" }
  if (-not $KeyPath) { throw "不知道用哪把 SSH 密钥：core.sshCommand 里没有 -i，用 -KeyPath 指定" }

  $ssh = (Get-Command ssh.exe -ErrorAction Stop).Source
  $scp = (Get-Command scp.exe -ErrorAction Stop).Source
  if (-not (Test-Path $KeyPath)) { throw "找不到 SSH 私钥：$KeyPath" }
  $sshArgs = @("-i", $KeyPath, "-o", "BatchMode=yes", "-o", "ConnectTimeout=20")

  # ── 1. 服务器上最新一份 ──
  $listing = & $ssh @sshArgs $Server "ls -1 $RemoteDir"
  if ($LASTEXITCODE -ne 0) { throw "ssh 列备份目录失败（退出码 $LASTEXITCODE）" }
  $remoteLatest = @($listing | Where-Object { $_ -match $stampPattern } | Sort-Object) | Select-Object -Last 1
  if (-not $remoteLatest) { throw "服务器 $RemoteDir 下没有备份目录" }

  # ── 2. 拉取。先落到 .partial，核对无误再改名——半截的包不能冒充一份完整备份 ──
  $target = Join-Path $LocalDir $remoteLatest
  if (Test-Path $target) {
    Write-Log "已是最新：$remoteLatest"
  } else {
    $partial = "$target.partial"
    if (Test-Path $partial) { Remove-Item -Recurse -Force $partial }
    New-Item -ItemType Directory -Path $partial | Out-Null

    & $scp @sshArgs -q "${Server}:$RemoteDir/$remoteLatest/*" "$partial\"
    if ($LASTEXITCODE -ne 0) { throw "scp 拉取 $remoteLatest 失败（退出码 $LASTEXITCODE）" }

    # ── 3. 逐个文件核对字节数，manifest.txt 必须在 ──
    $remoteSizes = & $ssh @sshArgs $Server "cd $RemoteDir/$remoteLatest && stat -c '%n %s' *"
    if ($LASTEXITCODE -ne 0) { throw "读取服务器端文件大小失败（退出码 $LASTEXITCODE）" }
    $totalBytes = 0
    foreach ($entry in $remoteSizes) {
      $parts = "$entry".Trim() -split ' ', 2
      $localFile = Join-Path $partial $parts[0]
      if (-not (Test-Path $localFile)) { throw "本机缺文件：$($parts[0])" }
      $localBytes = (Get-Item $localFile).Length
      if ($localBytes -ne [long]$parts[1]) {
        throw "$($parts[0]) 大小不一致：服务器 $($parts[1])，本机 $localBytes"
      }
      $totalBytes += $localBytes
    }
    if (-not (Test-Path (Join-Path $partial "manifest.txt"))) { throw "备份里没有 manifest.txt" }

    Rename-Item -Path $partial -NewName $remoteLatest
    Write-Log ("已拉取 {0}：{1} 个文件，{2:N1} MB" -f $remoteLatest, @($remoteSizes).Count, ($totalBytes / 1MB))
  }

  # ── 4. 服务器那边还在按时备份吗 ──
  $stampTime = [datetime]::ParseExact($remoteLatest, "yyyy-MM-dd_HHmm", [Globalization.CultureInfo]::InvariantCulture)
  $hours = ((Get-Date) - $stampTime).TotalHours
  if ($hours -gt $StaleHours) {
    Write-Log ("警告：服务器最新一份备份是 {0:N0} 小时前的，服务器上的每日备份可能停了，去看 /var/log/keticompass-backup.log" -f $hours)
    $exitCode = 2
  }

  # ── 5. 本机滚动保留 ──
  Get-ChildItem -Path $LocalDir -Directory |
    Where-Object { $_.Name -match $stampPattern } |
    Sort-Object Name -Descending |
    Select-Object -Skip $Keep |
    ForEach-Object {
      Remove-Item -Recurse -Force $_.FullName
      Write-Log "清理旧备份 $($_.Name)"
    }
} catch {
  Write-Log "失败：$($_.Exception.Message)"
  exit 1
}
exit $exitCode
