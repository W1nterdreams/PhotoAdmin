# bump-cache-version.ps1
# Обновляет cache-busting версию во всех локальных JS/CSS ссылках проекта.
# Положите этот файл в корень проекта рядом с index.html и папкой js.

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path

# Новая версия по текущей дате и времени: 20260919-230501
$version = Get-Date -Format "yyyyMMdd-HHmmss"

# Файлы, где меняем ?v=...
$files = @()

$index = Join-Path $root "index.html"
if (Test-Path $index) {
    $files += Get-Item $index
}

$jsDir = Join-Path $root "js"
if (Test-Path $jsDir) {
    $files += Get-ChildItem -Path $jsDir -Recurse -File -Filter "*.js"
}

$changed = 0

foreach ($file in $files) {
    $text = Get-Content -Path $file.FullName -Raw -Encoding UTF8
    $newText = $text

    # Меняем только версии после локальных .js?v=... и .css?v=...
    $newText = [regex]::Replace(
        $newText,
        '(\.(?:js|css)\?v=)[A-Za-z0-9._-]+',
        ('$1' + $version)
    )

    # Заодно обновляем комментарий в index.html:
    # <!-- CACHE_VERSION: 20260919-... -->
    if ($file.Name -eq "index.html") {
        $newText = [regex]::Replace(
            $newText,
            '(CACHE_VERSION:\s*)[A-Za-z0-9._-]+',
            ('$1' + $version)
        )
    }

    if ($newText -ne $text) {
        Set-Content -Path $file.FullName -Value $newText -Encoding UTF8
        Write-Host "Обновлён: $($file.FullName)"
        $changed++
    }
}

Write-Host ""
Write-Host "Готово."
Write-Host "Новая cache-busting версия: $version"
Write-Host "Изменено файлов: $changed"
Write-Host ""
Write-Host "Теперь загрузите изменённые файлы на GitHub."
