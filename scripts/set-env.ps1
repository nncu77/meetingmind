<#
  scripts/set-env.ps1 — write or update a single key in .env.local from clipboard.

  Usage:
    1. Copy your token to clipboard (Ctrl+C on the website)
    2. cd C:\Users\88693\projects\meetingmind
    3. .\scripts\set-env.ps1 GROQ_API_KEY

  The token never enters the chat — we read clipboard locally and write
  directly to .env.local. The script masks the value in stdout so you can
  paste a screenshot for help without leaking the key.
#>
param([Parameter(Mandatory=$true)][string]$Key)

$ErrorActionPreference = 'Stop'

$envFile      = Join-Path $PSScriptRoot '..\.env.local'
$exampleFile  = Join-Path $PSScriptRoot '..\.env.local.example'

if (-not (Test-Path $envFile)) {
    if (Test-Path $exampleFile) {
        Copy-Item $exampleFile $envFile
        Write-Host "Created .env.local from .env.local.example" -ForegroundColor Cyan
    } else {
        New-Item -ItemType File -Path $envFile | Out-Null
    }
}

$value = (Get-Clipboard -Raw).Trim()
if ([string]::IsNullOrWhiteSpace($value)) {
    Write-Error "Clipboard is empty. Copy your token, then re-run."
}

# Sanity guard — reject obvious mis-pastes (URL, too short, multiline)
if ($value -match '^\s*https?://' -or $value.Length -lt 10 -or $value -match "`r|`n") {
    Write-Error "Clipboard looks wrong (URL / too short / multi-line). Copy ONLY the token and retry."
}

$lines = Get-Content -LiteralPath $envFile -Encoding UTF8
$pattern = '^' + [regex]::Escape($Key) + '='
$found = $false
$out = $lines | ForEach-Object {
    if ($_ -match $pattern) { $found = $true; "$Key=$value" } else { $_ }
}
if (-not $found) { $out = @($out) + "$Key=$value" }

Set-Content -LiteralPath $envFile -Value $out -Encoding UTF8

$masked = if ($value.Length -gt 12) {
    $value.Substring(0,4) + '****' + $value.Substring($value.Length-3)
} else { '****' }
Write-Host "Set $Key=$masked  ($envFile)" -ForegroundColor Green
