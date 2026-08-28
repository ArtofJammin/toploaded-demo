# Builds two outputs from tools/site-src.html:
#   ../index.html      — LEAN web build (no embedded demo card art; ~100KB).
#                        The live site loads real inventory.json anyway, and
#                        demo items fall back to drawn SVG card faces.
#   tools/artifact.html — FAT build with demo card art embedded as data URIs,
#                        for publishing as the self-contained Claude artifact.
# Edit tools/site-src.html, run this, commit index.html.
$tools = $PSScriptRoot
$repo = Split-Path -Parent $tools
$art = Join-Path $tools "cardart"
$marker = '<script id="cardArtData"></script>'
$utf8 = New-Object System.Text.UTF8Encoding($false)
$html = [IO.File]::ReadAllText((Join-Path $tools "site-src.html"), [Text.Encoding]::UTF8)
if(-not $html.Contains($marker)){ throw "cardArtData marker missing from site-src.html" }

# lean web build
[IO.File]::WriteAllText((Join-Path $repo "index.html"), $html, $utf8)
Write-Output ("Built index.html (lean): " + [math]::Round((Get-Item (Join-Path $repo "index.html")).Length/1KB) + " KB")

# fat artifact build
$keys = @("pk-charizard151","pk-pikachuhat","pk-tatsugiri","pk-iono","pk-roaringmoon","op-shanks-op09","op-luffy-op05","op-boa-op07","op-law-op01","mtg-ragavan","mtg-sheoldred","mtg-onering","mtg-bowmasters")
function Get-DataUri($key){
  $png = Join-Path $art "$key.png"; $jpg = Join-Path $art "$key.jpg"
  if(Test-Path $jpg){ $f = $jpg; $mime = "image/jpeg" } elseif(Test-Path $png){ $f = $png; $mime = "image/png" } else { throw "missing $key" }
  return "data:$mime;base64," + [Convert]::ToBase64String([IO.File]::ReadAllBytes($f))
}
$pairs = $keys | ForEach-Object { '"' + $_ + '":"' + (Get-DataUri $_) + '"' }
$block = '<script id="cardArtData">window.CARD_IMG={' + ($pairs -join ",") + '};</script>'
[IO.File]::WriteAllText((Join-Path $tools "artifact.html"), $html.Replace($marker, $block), $utf8)
Write-Output ("Built tools/artifact.html (fat): " + [math]::Round((Get-Item (Join-Path $tools "artifact.html")).Length/1MB, 2) + " MB")
