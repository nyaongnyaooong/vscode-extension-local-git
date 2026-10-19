#!/bin/sh
# Builds local-lens.vsix by hand (no vsce / npm download needed).
set -e
cd "$(dirname "$0")"
VERSION=$(node -p "require('./package.json').version")
OUT=$(mktemp -d)
mkdir "$OUT/extension"
cp package.json extension.js lib.js README.md "$OUT/extension/"
cat > "$OUT/[Content_Types].xml" <<'EOF'
<?xml version="1.0" encoding="utf-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension=".json" ContentType="application/json"/><Default Extension=".js" ContentType="application/javascript"/><Default Extension=".md" ContentType="text/markdown"/><Default Extension=".vsixmanifest" ContentType="text/xml"/></Types>
EOF
cat > "$OUT/extension.vsixmanifest" <<EOF
<?xml version="1.0" encoding="utf-8"?>
<PackageManifest Version="2.0.0" xmlns="http://schemas.microsoft.com/developer/vsx-schema/2011" xmlns:d="http://schemas.microsoft.com/developer/vsx-schema-design/2011">
  <Metadata>
    <Identity Language="en-US" Id="local-lens" Version="$VERSION" Publisher="local" />
    <DisplayName>Local Lens</DisplayName>
    <Description xml:space="preserve">GitLens-style blame and history using only the local git CLI.</Description>
    <Properties>
      <Property Id="Microsoft.VisualStudio.Code.Engine" Value="^1.80.0" />
      <Property Id="Microsoft.VisualStudio.Code.ExtensionKind" Value="workspace" />
    </Properties>
  </Metadata>
  <Installation><InstallationTarget Id="Microsoft.VisualStudio.Code" /></Installation>
  <Dependencies />
  <Assets><Asset Type="Microsoft.VisualStudio.Code.Manifest" Path="extension/package.json" Addressable="true" /></Assets>
</PackageManifest>
EOF
rm -f local-lens.vsix
(cd "$OUT" && zip -qr - .) > local-lens.vsix
rm -rf "$OUT"
echo "built local-lens.vsix ($VERSION)"
