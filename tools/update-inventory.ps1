# Nightly inventory refresh for the Top Loaded site.
# Pulls live TCGplayer listings, and if anything changed, commits and pushes
# inventory.json so GitHub Pages redeploys with fresh stock.
$repo = Split-Path -Parent $PSScriptRoot
$log = Join-Path $PSScriptRoot "update-inventory.log"
Set-Location $repo

function Log($msg){
    $line = (Get-Date -Format "yyyy-MM-dd HH:mm:ss") + "  " + $msg
    Add-Content -Path $log -Value $line -Encoding utf8
    Write-Output $line
}

Log "--- nightly inventory run ---"
python (Join-Path $PSScriptRoot "update-inventory.py") 2>&1 | ForEach-Object { Log $_ }
if ($LASTEXITCODE -ne 0 -and $null -ne $LASTEXITCODE) {
    Log "FETCH FAILED (exit $LASTEXITCODE) - keeping previous inventory.json"
    exit 1
}

$changed = git status --porcelain inventory.json
if ($changed) {
    git add inventory.json
    git commit -m ("Nightly inventory update " + (Get-Date -Format "yyyy-MM-dd")) --quiet
    git push --quiet
    if ($LASTEXITCODE -eq 0) { Log "pushed updated inventory.json" }
    else { Log "PUSH FAILED (exit $LASTEXITCODE)" }
} else {
    Log "no inventory changes"
}

# keep the log from growing forever
$lines = Get-Content $log
if ($lines.Count -gt 2000) { $lines[-1000..-1] | Set-Content $log -Encoding utf8 }
