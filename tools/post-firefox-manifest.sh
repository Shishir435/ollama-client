#!/bin/bash

# Post-build script to clean Firefox manifest.json files
# Removes Chrome-specific permissions (sidePanel, declarativeNetRequest) from Firefox builds
#
# This script uses Node.js to parse and modify JSON, which is:
# - More reliable than bash string manipulation
# - Cross-platform compatible (Mac/Linux/Windows)
# - Already available in this project (no extra dependencies)

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Chrome-specific permissions to remove from Firefox builds
CHROME_PERMISSIONS=(
  "sidePanel"
  "declarativeNetRequest"
)

# Function to clean a manifest file
clean_manifest() {
  local manifest_file="$1"
  
  if [ ! -f "$manifest_file" ]; then
    return
  fi
  
  # Use Node.js to parse JSON, filter permissions, and write back
  node << EOF
const fs = require('fs');

const manifestPath = '$manifest_file';
const chromePermissions = [
  'sidePanel',
  'declarativeNetRequest'
];

try {
  // Read and parse manifest
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  
  // Get current permissions
  const originalPermissions = manifest.permissions || [];
  
  // Filter out Chrome-specific permissions
  const filteredPermissions = originalPermissions.filter(
    perm => !chromePermissions.includes(perm)
  );
  
  // Only update if permissions changed
  if (JSON.stringify(filteredPermissions) !== JSON.stringify(originalPermissions)) {
    manifest.permissions = filteredPermissions;
    
    // Write back with proper formatting
    fs.writeFileSync(
      manifestPath,
      JSON.stringify(manifest, null, 2) + '\n',
      'utf8'
    );
    
    const removed = originalPermissions.filter(
      perm => !filteredPermissions.includes(perm)
    );
    
    if (removed.length > 0) {
      console.log(\`🟢 Cleaned: \$manifest_file\`);
      console.log(\`🟢 Removed: [\${removed.join(', ')}]\`);
    }
  }
} catch (error) {
  console.error(\`🔴 ERROR  | Error processing \$manifest_file: \${error.message}\`);
  process.exit(1);
}
EOF
}

# Function to clean all Firefox manifests
clean_all_firefox_manifests() {
  echo "🔵 INFO   | Cleaning Firefox manifest files..."
  
  # Find all Firefox build directories
  find "$PROJECT_ROOT/build" -type d \( -name "*firefox*" -o -name "*gecko*" \) 2>/dev/null | while read -r firefox_dir; do
    manifest_file="${firefox_dir}/manifest.json"
    if [ -f "$manifest_file" ]; then
      clean_manifest "$manifest_file"
    fi
  done
}

# Check if watch mode is requested
if [ "$1" = "--watch" ]; then
  echo "🟣 Watching Firefox manifest files for changes..."
  
  # Initial clean
  clean_all_firefox_manifests
  
  # Watch using Node.js
  node << WATCH_EOF
const fs = require('fs');
const path = require('path');

const projectRoot = '$PROJECT_ROOT';
const buildDir = path.join(projectRoot, 'build');
const scriptPath = path.join(projectRoot, 'tools', 'post-firefox-manifest.sh');

// Chrome permissions to remove
const chromePermissions = ['sidePanel', 'declarativeNetRequest'];

// Function to clean a single manifest
function cleanManifest(manifestPath) {
  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const originalPermissions = manifest.permissions || [];
    const filteredPermissions = originalPermissions.filter(
      perm => !chromePermissions.includes(perm)
    );
    
    if (JSON.stringify(filteredPermissions) !== JSON.stringify(originalPermissions)) {
      manifest.permissions = filteredPermissions;
      fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
      
      const removed = originalPermissions.filter(p => !filteredPermissions.includes(p));
      console.log(\`\n🟢 Cleaned: \${path.relative(projectRoot, manifestPath)}\`);
      if (removed.length > 0) {
        console.log(\`🟢 Removed: [\${removed.join(', ')}]\`);
      }
    }
  } catch (error) {
    // Ignore errors (file might be locked or invalid)
    // Silently fail to avoid spam during watch mode
  }
}

// Function to find and clean all Firefox manifests
function cleanAllManifests() {
  function walkDir(dir) {
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        
        if (entry.isDirectory()) {
          if (entry.name.includes('firefox') || entry.name.includes('gecko')) {
            const manifestPath = path.join(fullPath, 'manifest.json');
            if (fs.existsSync(manifestPath)) {
              cleanManifest(manifestPath);
            }
          }
          walkDir(fullPath);
        }
      }
    } catch (err) {
      // Ignore errors (directory might not exist yet)
    }
  }
  
  if (fs.existsSync(buildDir)) {
    walkDir(buildDir);
  }
}

// Watch build directory recursively
if (fs.existsSync(buildDir)) {
  fs.watch(buildDir, { recursive: true }, (eventType, filename) => {
    if (filename && filename.includes('manifest.json')) {
      // Debounce: wait a bit for file write to complete
      setTimeout(() => {
        cleanAllManifests();
      }, 200);
    }
  });
  
  // Initial clean
  cleanAllManifests();
} else {
  // Poll until build directory exists
  const pollInterval = setInterval(() => {
    if (fs.existsSync(buildDir)) {
      clearInterval(pollInterval);
      
      fs.watch(buildDir, { recursive: true }, (eventType, filename) => {
        if (filename && filename.includes('manifest.json')) {
          setTimeout(() => {
            cleanAllManifests();
          }, 200);
        }
      });
      
      cleanAllManifests();
    }
  }, 1000);
}

// Keep process alive
console.log('🔵 INFO   | Manifest watcher started. Press Ctrl+C to stop.');
process.on('SIGINT', () => {
  console.log('\n🔵 INFO   | Stopping manifest watcher...');
  process.exit(0);
});
WATCH_EOF
else
  # Single run mode - clean all manifests
  if [ -n "$1" ]; then
    # If a specific file is provided, clean just that one
    clean_manifest "$1"
  else
    clean_all_firefox_manifests
    echo "🟢 DONE   | Firefox manifest cleanup complete!"
  fi
fi
