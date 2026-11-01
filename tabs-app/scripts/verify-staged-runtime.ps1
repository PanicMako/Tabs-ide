param([Parameter(Mandatory)] [string]$StageDir)
$ErrorActionPreference = 'Stop'
try {
  $runtime = Join-Path $StageDir 'resources\tabs-code-oss'
  $manifestPath = Join-Path $runtime 'tabs-payload.json'
  $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
  if (-not $manifest.packedFiles -or $manifest.packedFiles -gt 50000) {
    throw 'The staged editor has no valid packed file inventory.'
  }
  $count = @(Get-ChildItem -LiteralPath $runtime -Recurse -File -Force |
    Where-Object { $_.FullName -ne $manifestPath }).Count
  if ($count -ne $manifest.packedFiles) {
    throw "Incomplete editor extraction: expected $($manifest.packedFiles) files, got $count."
  }
  foreach ($relative in @(
    'Tabs.exe',
    'resources\app.asar',
    'resources\tabs-code-oss\out\vs\code\electron-browser\workbench\workbench-dev.html',
    'resources\tabs-code-oss\out\nls.messages.json',
    'resources\tabs-code-oss\out-build\nls.messages.json',
    'resources\tabs-code-oss\node_modules\@anthropic-ai\claude-agent-sdk\sdk.mjs',
    'resources\tabs-code-oss\extensions\node_modules\typescript\lib\typescript.js',
    'resources\tabs-code-oss\extensions\node_modules\typescript\lib\lib.d.ts',
    'resources\tabs-code-oss\extensions\node_modules\typescript\lib\lib.es5.d.ts',
    'resources\tabs-code-oss\extensions\node_modules\typescript\lib\lib.dom.d.ts'
  )) {
    if (-not (Test-Path -LiteralPath (Join-Path $StageDir $relative) -PathType Leaf)) {
      throw "Incomplete full-fat application extraction: $relative"
    }
  }
  Write-Output "Verified full-fat staged editor: $count files."
  exit 0
} catch {
  Write-Output "Staged application validation failed: $_"
  exit 2
}
