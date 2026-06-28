$ErrorActionPreference = "Stop"

$root = Resolve-Path (Join-Path $PSScriptRoot "..")
$frontend = Join-Path $root "frontend"
$backendPort = if ($env:VITE_BACKEND_PORT) { [int]$env:VITE_BACKEND_PORT } else { 8001 }
$backendProcess = $null
$startedBackend = $false

function Test-Port {
  param([int]$Port)

  $client = [System.Net.Sockets.TcpClient]::new()
  try {
    $connect = $client.BeginConnect("127.0.0.1", $Port, $null, $null)
    if (-not $connect.AsyncWaitHandle.WaitOne(500)) {
      return $false
    }
    $client.EndConnect($connect)
    return $true
  } catch {
    return $false
  } finally {
    $client.Close()
  }
}

if (-not (Test-Path (Join-Path $root ".env")) -and (Test-Path (Join-Path $root ".env.example"))) {
  Copy-Item (Join-Path $root ".env.example") (Join-Path $root ".env")
}

if (Test-Port $backendPort) {
  Write-Host "Backend already running on http://127.0.0.1:$backendPort"
} else {
  $py = Get-Command py -ErrorAction SilentlyContinue
  if ($py) {
    $pythonCommand = $py.Source
    $pythonArgs = @("-3", "-m", "uvicorn", "app.main:app", "--port", "$backendPort")
  } else {
    $pythonCommand = "python"
    $pythonArgs = @("-m", "uvicorn", "app.main:app", "--port", "$backendPort")
  }

  Write-Host "Starting backend on http://127.0.0.1:$backendPort ..."
  $backendProcess = Start-Process `
    -FilePath $pythonCommand `
    -ArgumentList $pythonArgs `
    -WorkingDirectory $root `
    -NoNewWindow `
    -PassThru
  $startedBackend = $true

  $deadline = (Get-Date).AddSeconds(25)
  while (-not (Test-Port $backendPort)) {
    if ($backendProcess.HasExited) {
      throw "Backend exited before it started. Run: py -3 -m uvicorn app.main:app --reload --port $backendPort"
    }
    if ((Get-Date) -gt $deadline) {
      throw "Backend did not start on port $backendPort within 25 seconds."
    }
    Start-Sleep -Milliseconds 500
  }
}

try {
  Write-Host "Starting frontend on http://localhost:5173 ..."
  Push-Location $frontend
  try {
    $viteCommand = Join-Path $frontend "node_modules\.bin\vite.cmd"
    if (Test-Path $viteCommand) {
      & $viteCommand --host localhost
    } else {
      npm exec vite -- --host localhost
    }
  } finally {
    Pop-Location
  }
} finally {
  if ($startedBackend -and $backendProcess -and -not $backendProcess.HasExited) {
    Write-Host "Stopping backend..."
    Stop-Process -Id $backendProcess.Id -Force
  }
}
