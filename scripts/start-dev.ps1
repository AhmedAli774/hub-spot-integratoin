# Starts the Wix CLI dev server and exposes it publicly via ngrok.
# Architecture:
#   npm run dev  -> Wix CLI (Vite dashboard bundle on :5173) + Astro API routes on :4321
#   dev-proxy    -> port 5175: /api/* -> :4321, rest -> :5173
#   ngrok        -> https://<your-domain>.ngrok-free.dev -> :5175

param(
  [int]$ProxyPort   = 5175,
  [int]$VitePort    = 5173,
  [int]$AstroPort   = 4321,
  [int]$WaitSeconds = 45,
  [string]$NgrokDomain = $null
)

$Root = Split-Path $PSScriptRoot -Parent

# If NgrokDomain not provided via parameter, try to read from .env
if (-not $NgrokDomain) {
  $envFile = Join-Path $Root ".env"
  if (Test-Path $envFile) {
    $envContent = Get-Content $envFile -Raw
    $match = [regex]::Match($envContent, 'PUBLIC_API_BASE=https://(.+)')
    if ($match.Success) {
      $NgrokDomain = $match.Groups[1].Value.Trim()
    }
  }
}

# Validate we have a domain
if (-not $NgrokDomain) {
  Write-Host "  ERROR: NgrokDomain not provided and not found in .env file." -ForegroundColor Red
  Write-Host "  Either pass -NgrokDomain parameter or set PUBLIC_API_BASE in .env" -ForegroundColor Yellow
  exit 1
}

function Write-Header {
  Write-Host ""
  Write-Host "============================================" -ForegroundColor Cyan
  Write-Host "   Wix <-> HubSpot  --  Dev Environment   " -ForegroundColor Cyan
  Write-Host "============================================" -ForegroundColor Cyan
  Write-Host ""
}

Write-Header

# Check node
if (-not (Get-Command "node" -ErrorAction SilentlyContinue)) {
  Write-Host "  ERROR: Node.js not found." -ForegroundColor Red
  exit 1
}

# Check ngrok
$ngrokCmd = Get-Command "ngrok" -ErrorAction SilentlyContinue
if (-not $ngrokCmd) {
  Write-Host "  ERROR: ngrok not found." -ForegroundColor Red
  Write-Host "  Install: npm install -g ngrok" -ForegroundColor Yellow
  Write-Host "  Then:    ngrok config add-authtoken <your-token>" -ForegroundColor Yellow
  Write-Host "  Token:   https://dashboard.ngrok.com" -ForegroundColor Yellow
  exit 1
}
$ngrokPath = $ngrokCmd.Source
Write-Host "  ngrok found: $ngrokPath" -ForegroundColor DarkGray

# Start dev API server (port $AstroPort) — replaces `astro dev` which needs Node >=22
Write-Host "  Starting dev API server (port $AstroPort)..." -ForegroundColor Yellow
$apiServerScript = Join-Path $PSScriptRoot "api-dev-server.mjs"
$apiServer = Start-Process -FilePath "powershell.exe" `
  -ArgumentList "-NoExit", "-Command", "Set-Location '$Root'; node '$apiServerScript'" `
  -WorkingDirectory $Root `
  -PassThru -WindowStyle Normal
Write-Host "  API server started (PID: $($apiServer.Id))" -ForegroundColor DarkGray
Start-Sleep 3

# Start dev proxy (keep window open so errors are visible)
Write-Host "  Starting dev proxy (port $ProxyPort)..." -ForegroundColor Yellow
$proxyScript = Join-Path $PSScriptRoot "dev-proxy.mjs"
$proxy = Start-Process -FilePath "powershell.exe" `
  -ArgumentList "-NoExit", "-Command", "Set-Location '$Root'; node '$proxyScript'" `
  -WorkingDirectory $Root `
  -PassThru -WindowStyle Normal
Write-Host "  Proxy started (PID: $($proxy.Id))" -ForegroundColor DarkGray
Start-Sleep 2

# Start Wix dev server
Write-Host "  Starting Wix dev server (npm run dev)..." -ForegroundColor Yellow
Start-Process -FilePath "powershell.exe" `
  -ArgumentList "-NoExit", "-Command", "Set-Location '$Root'; npm run dev -- --origin https://$NgrokDomain"

Write-Host "  Waiting $WaitSeconds s for Vite dev server (port $VitePort) ..." -ForegroundColor DarkGray
Start-Sleep $WaitSeconds

# Verify Vite is up (check TCP port, not HTTP 200, since Wix dashboard has no root route)
$viteUp = $false
for ($t = 0; $t -lt 20; $t++) {
  $test = Test-NetConnection -ComputerName 127.0.0.1 -Port $VitePort -WarningAction SilentlyContinue
  if ($test.TcpTestSucceeded) { $viteUp = $true; break }
  Start-Sleep 3
}
if (-not $viteUp) {
  Write-Host "  WARNING: Nothing on port $VitePort yet. Continuing anyway." -ForegroundColor Yellow
} else {
  Write-Host "  Vite confirmed on port $VitePort." -ForegroundColor Green
}

# Start ngrok with static domain
Write-Host ""
Write-Host "  Starting ngrok -> $NgrokDomain -> port $ProxyPort ..." -ForegroundColor Yellow

$ngrok = $null
try {
  $ngrok = Start-Process -FilePath $ngrokPath `
    -ArgumentList "http", "--url=$NgrokDomain", "$ProxyPort" `
    -PassThru -WindowStyle Hidden -ErrorAction Stop
  Write-Host "  ngrok started (PID: $($ngrok.Id))" -ForegroundColor DarkGray
} catch {
  Write-Host "  WARNING: Could not start ngrok: $_" -ForegroundColor Yellow
  Write-Host "  Run manually: ngrok http --url=$NgrokDomain $ProxyPort" -ForegroundColor Yellow
}

Start-Sleep 4

# Fetch public URL from ngrok API
$publicUrl = $null
for ($i = 0; $i -lt 8; $i++) {
  try {
    $tunnels = Invoke-RestMethod -Uri "http://127.0.0.1:4040/api/tunnels" -ErrorAction Stop
    $publicUrl = ($tunnels.tunnels | Where-Object { $_.proto -eq "https" }).public_url
    if ($publicUrl) { break }
  } catch { }
  Start-Sleep 2
}

if (-not $publicUrl) {
  $publicUrl = "https://$NgrokDomain"
}

# Print results
$callbackUrl = "$publicUrl/api/auth/callback"
$wixWebhook  = "$publicUrl/api/webhooks/wix"
$hsWebhook   = "$publicUrl/api/webhooks/hubspot"

Write-Host ""
Write-Host "============================================" -ForegroundColor Green
Write-Host "  NGROK TUNNEL IS LIVE                     " -ForegroundColor Green
Write-Host "============================================" -ForegroundColor Green
Write-Host ""
Write-Host "  Public URL : $publicUrl" -ForegroundColor Green
Write-Host "  Proxy      : http://127.0.0.1:$ProxyPort  (/api/* -> $AstroPort, rest -> $VitePort)" -ForegroundColor DarkGray
Write-Host "  ngrok UI   : http://127.0.0.1:4040" -ForegroundColor DarkGray
Write-Host ""
Write-Host "  -- .env values (already set) --" -ForegroundColor Yellow
Write-Host "  PUBLIC_API_BASE=$publicUrl" -ForegroundColor White
Write-Host "  HUBSPOT_REDIRECT_URI=$callbackUrl" -ForegroundColor White
Write-Host ""
Write-Host "  -- HubSpot Dev Center redirect URL --" -ForegroundColor Yellow
Write-Host "  $callbackUrl" -ForegroundColor White
Write-Host ""
Write-Host "  -- Webhook URLs --" -ForegroundColor Yellow
Write-Host "  Wix webhook    : $wixWebhook" -ForegroundColor Cyan
Write-Host "  HubSpot webhook: $hsWebhook" -ForegroundColor Cyan
Write-Host ""

try {
  "PUBLIC_API_BASE=$publicUrl`nHUBSPOT_REDIRECT_URI=$callbackUrl" | Set-Clipboard
  Write-Host "  .env values copied to clipboard!" -ForegroundColor Green
} catch { }

Write-Host ""
Write-Host "  Press Ctrl+C to exit." -ForegroundColor DarkGray
Write-Host ""

# Keep script alive
try {
  if ($ngrok -and $ngrok.Id) {
    Wait-Process -Id $ngrok.Id -ErrorAction SilentlyContinue
  } else {
    while ($true) { Start-Sleep 60 }
  }
} finally {
  if ($ngrok -and $ngrok.Id) {
    Write-Host "  Stopping ngrok..." -ForegroundColor Yellow
    Stop-Process -Id $ngrok.Id -ErrorAction SilentlyContinue
  }
  if ($proxy -and $proxy.Id) {
    Write-Host "  Stopping proxy..." -ForegroundColor Yellow
    Stop-Process -Id $proxy.Id -ErrorAction SilentlyContinue
  }
  if ($apiServer -and $apiServer.Id) {
    Write-Host "  Stopping API server..." -ForegroundColor Yellow
    Stop-Process -Id $apiServer.Id -ErrorAction SilentlyContinue
  }
}
