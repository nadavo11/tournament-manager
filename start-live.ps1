param([switch]$RenewTunnel)
$ErrorActionPreference = 'Stop'
$repoRoot = $PSScriptRoot
$runtimeRoot = Join-Path (Split-Path $repoRoot) '.runtime'
$backendRoot = Join-Path $repoRoot 'backend'
$privateRoot = Join-Path $repoRoot '.local'
& (Join-Path $runtimeRoot 'pgsql\bin\pg_ctl.exe') -D (Join-Path $runtimeRoot 'pgdata') status
if ($LASTEXITCODE -ne 0) {
    & (Join-Path $runtimeRoot 'pgsql\bin\pg_ctl.exe') -D (Join-Path $runtimeRoot 'pgdata') -l (Join-Path $runtimeRoot 'postgres.log') -o '-p 55432 -h 127.0.0.1' start
}
$active = Get-NetTCPConnection -LocalPort 8400 -State Listen -ErrorAction SilentlyContinue
if (-not $active) {
    Start-Process -FilePath (Join-Path $backendRoot '.venv\Scripts\python.exe') -ArgumentList 'serve_live.py' -WorkingDirectory $backendRoot -RedirectStandardOutput (Join-Path $privateRoot 'server.log') -RedirectStandardError (Join-Path $privateRoot 'server-error.log') -WindowStyle Hidden
}
$tunnelExe = Join-Path $runtimeRoot 'cloudflared.exe'
$ownedTunnels = @(Get-CimInstance Win32_Process -Filter "Name='cloudflared.exe'" | Where-Object { $_.ExecutablePath -eq $tunnelExe -and $_.CommandLine -match '127\.0\.0\.1:8400' })
if ($RenewTunnel) {
    $ownedTunnels | ForEach-Object { Stop-Process -Id $_.ProcessId }
    $ownedTunnels = @()
}
if ($ownedTunnels.Count -eq 0) {
    Start-Process -FilePath $tunnelExe -ArgumentList 'tunnel','--url','http://127.0.0.1:8400','--protocol','http2','--edge-ip-version','4','--no-autoupdate' -RedirectStandardOutput (Join-Path $runtimeRoot 'tunnel.log') -RedirectStandardError (Join-Path $runtimeRoot 'tunnel-error.log') -WindowStyle Hidden
}
Write-Output 'Local URL: http://127.0.0.1:8400'
Write-Output "Public URL is recorded in $runtimeRoot\tunnel-error.log (may change after tunnel restart)."
Write-Output 'If the temporary public address expires while cloudflared remains running, run ./start-live.ps1 -RenewTunnel to create a replacement address.'
