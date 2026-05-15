const fs = require('fs');
const path = require('path');

const packageJsonPath = path.join(__dirname, 'package.json');
const manifestJsonPath = path.join(__dirname, 'manifest.json');

try {
  // Read both files
  const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  const manifest = JSON.parse(fs.readFileSync(manifestJsonPath, 'utf8'));

  // Split version parts and increment the patch number
  const versionParts = pkg.version.split('.').map(Number);
  
  if (versionParts.length === 3) {
    versionParts[2] += 1;
  } else {
    // Fallback if version is not semver strictly
    versionParts.push(1);
  }

  const newVersion = versionParts.join('.');

  // Assign the new version
  pkg.version = newVersion;
  manifest.version = newVersion;

  // Write changes securely
  fs.writeFileSync(packageJsonPath, JSON.stringify(pkg, null, 2) + '\n');
  fs.writeFileSync(manifestJsonPath, JSON.stringify(manifest, null, 2) + '\n');

  console.log(`\x1b[32m✅ Version successfully bumped to ${newVersion} in package.json and manifest.json\x1b[0m`);
} catch (error) {
  console.error('\x1b[31m❌ Error bumping version:\x1b[0m', error);
  process.exit(1);
}
