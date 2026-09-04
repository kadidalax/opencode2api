Set-Location $PSScriptRoot
if (-not (Test-Path node_modules)) { npm ci --omit=dev }
node server.js
