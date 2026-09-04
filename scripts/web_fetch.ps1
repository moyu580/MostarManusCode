param(
  [Parameter(Mandatory = $true)]
  [string]$Url,

  [int]$MaxChars = 12000
)

$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.Web

if ($Url -notmatch '^https?://') {
  throw "Only http/https URLs are supported."
}

$headers = @{
  "User-Agent" = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36"
}

$response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 30 -Headers $headers
$bytes = $response.RawContentStream.ToArray()
$charset = ""
$contentType = $response.Headers["Content-Type"]
if ($contentType -match 'charset=([^;\s]+)') {
  $charset = $matches[1].Trim('"')
}
if (-not $charset) {
  $headText = [Text.Encoding]::ASCII.GetString($bytes, 0, [Math]::Min($bytes.Length, 4096))
  if ($headText -match 'charset=["'']?([^"''>\s]+)') {
    $charset = $matches[1]
  }
}
try {
  $encoding = if ($charset) { [Text.Encoding]::GetEncoding($charset) } else { [Text.Encoding]::UTF8 }
} catch {
  $encoding = [Text.Encoding]::UTF8
}
$html = $encoding.GetString($bytes)

$title = ""
$titleMatch = [regex]::Match($html, '<title[^>]*>(?<title>.*?)</title>', 'IgnoreCase,Singleline')
if ($titleMatch.Success) {
  $title = [System.Web.HttpUtility]::HtmlDecode(($titleMatch.Groups["title"].Value -replace '\s+', ' ').Trim())
}

$clean = $html
$clean = [regex]::Replace($clean, '<script[\s\S]*?</script>', ' ', 'IgnoreCase')
$clean = [regex]::Replace($clean, '<style[\s\S]*?</style>', ' ', 'IgnoreCase')
$clean = [regex]::Replace($clean, '<noscript[\s\S]*?</noscript>', ' ', 'IgnoreCase')
$clean = [regex]::Replace($clean, '<br\s*/?>', "`n", 'IgnoreCase')
$clean = [regex]::Replace($clean, '</(p|div|li|h1|h2|h3|h4|tr)>', "`n", 'IgnoreCase')
$clean = [regex]::Replace($clean, '<[^>]+>', ' ')
$clean = [System.Web.HttpUtility]::HtmlDecode($clean)
$clean = [regex]::Replace($clean, "[`t ]+", ' ')
$clean = [regex]::Replace($clean, "(\r?\n\s*){3,}", "`n`n")
$clean = $clean.Trim()

if ($clean.Length -gt $MaxChars) {
  $clean = $clean.Substring(0, $MaxChars) + "`n`n[truncated]"
}

[pscustomobject]@{
  url = $Url
  title = $title
  statusCode = [int]$response.StatusCode
  content = $clean
} | ConvertTo-Json -Depth 4
