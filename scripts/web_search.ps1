param(
  [Parameter(Mandatory = $true)]
  [string]$Query,

  [int]$Limit = 8,

  [ValidateSet("bing", "duckduckgo")]
  [string]$Engine = "duckduckgo"
)

$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.Web

function Decode-Html([string]$Value) {
  if ([string]::IsNullOrWhiteSpace($Value)) {
    return ""
  }
  return [System.Web.HttpUtility]::HtmlDecode(($Value -replace '<[^>]+>', ' ' -replace '\s+', ' ').Trim())
}

function Resolve-Url([string]$Href) {
  if ([string]::IsNullOrWhiteSpace($Href)) {
    return ""
  }
  $decoded = [System.Web.HttpUtility]::HtmlDecode($Href)
  if ($decoded -like "/ck/a?*") {
    $uri = [Uri]"https://www.bing.com$decoded"
    $query = [System.Web.HttpUtility]::ParseQueryString($uri.Query)
    $u = $query.Get("u")
    if ($u) {
      try {
        return [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($u.TrimStart("a1")))
      } catch {
        return $u
      }
    }
  }
  if ($decoded -like "//duckduckgo.com/l/?*") {
    $uri = [Uri]"https:$decoded"
    $query = [System.Web.HttpUtility]::ParseQueryString($uri.Query)
    $uddg = $query.Get("uddg")
    if ($uddg) {
      return [System.Web.HttpUtility]::UrlDecode($uddg)
    }
  }
  return $decoded
}

$encodedQuery = [Uri]::EscapeDataString($Query)
$headers = @{
  "User-Agent" = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36"
}

if ($Engine -eq "duckduckgo") {
  $url = "https://duckduckgo.com/html/?q=$encodedQuery"
} else {
  $url = "https://www.bing.com/search?q=$encodedQuery"
}

$response = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 25 -Headers $headers
$html = $response.Content
$items = @()

if ($Engine -eq "duckduckgo") {
  $matches = [regex]::Matches($html, '<a[^>]+class="result__a"[^>]+href="(?<href>[^"]+)"[^>]*>(?<title>.*?)</a>[\s\S]*?<a[^>]+class="result__snippet"[^>]*href="[^"]*"[^>]*>(?<snippet>.*?)</a>', 'IgnoreCase')
  foreach ($m in $matches) {
    $items += [pscustomobject]@{
      title = Decode-Html $m.Groups["title"].Value
      url = Resolve-Url $m.Groups["href"].Value
      snippet = Decode-Html $m.Groups["snippet"].Value
    }
  }
} else {
  $matches = [regex]::Matches($html, '<li class="b_algo"[\s\S]*?<h2[^>]*>\s*<a[^>]+href="(?<href>[^"]+)"[^>]*>(?<title>.*?)</a>[\s\S]*?(?:<p[^>]*>(?<snippet>.*?)</p>)?', 'IgnoreCase')
  foreach ($m in $matches) {
    $items += [pscustomobject]@{
      title = Decode-Html $m.Groups["title"].Value
      url = Resolve-Url $m.Groups["href"].Value
      snippet = Decode-Html $m.Groups["snippet"].Value
    }
  }
}

$items |
  Where-Object { $_.title -and $_.url -and $_.url -match '^https?://' } |
  Select-Object -First $Limit |
  ConvertTo-Json -Depth 4
