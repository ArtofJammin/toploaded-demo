# Rebuilds ../index.html from site-src.html by injecting the embedded demo
# card art (tools/cardart/*) into the cardArtData script tag.
# Edit tools/site-src.html, run this, commit index.html.
$tools = $PSScriptRoot
$repo = Split-Path -Parent $tools
$art = Join-Path $tools "cardart"
$out = Join-Path $repo "index.html"
$keys = @("pk-charizard151","pk-pikachuhat","pk-tatsugiri","pk-iono","pk-roaringmoon","op-shanks-op09","op-luffy-op05","op-boa-op07","op-law-op01","mtg-ragavan","mtg-sheoldred","mtg-onering","mtg-bowmasters")
function Get-DataUri($key){
  $png = Join-Path $art "$key.png"; $jpg = Join-Path $art "$key.jpg"
  if(Test-Path $jpg){ $f = $jpg; $mime = "image/jpeg" } elseif(Test-Path $png){ $f = $png; $mime = "image/png" } else { throw "missing $key" }
  return "data:$mime;base64," + [Convert]::ToBase64String([IO.File]::ReadAllBytes($f))
}
$html = [IO.File]::ReadAllText((Join-Path $tools "site-src.html"), [Text.Encoding]::UTF8)
$marker = '<script id="cardArtData"></script>'
if(-not $html.Contains($marker)){ throw "cardArtData marker missing from site-src.html" }
$pairs = $keys | ForEach-Object { '"' + $_ + '":"' + (Get-DataUri $_) + '"' }
$block = '<script id="cardArtData">window.CARD_IMG={' + ($pairs -join ",") + '};</script>'
$utf8 = New-Object System.Text.UTF8Encoding($false)
[IO.File]::WriteAllText($out, $html.Replace($marker, $block), $utf8)
Write-Output ("Built " + $out + " (" + [math]::Round((Get-Item $out).Length/1MB,2) + " MB)")
