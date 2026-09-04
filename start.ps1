Set-Location $PSScriptRoot
if (-not (Test-Path node_modules)) { npm install }
node server.js
