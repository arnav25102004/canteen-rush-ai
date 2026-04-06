const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;

const config = getDefaultConfig(projectRoot);

// Keep Metro focused on the mobile app to reduce memory usage on Windows.
// exclusionList import is broken in metro-config 0.83 — use plain regexes directly.
config.resolver.blockList = [
  /.*[\\/]archive_old_version[\\/].*/,
  /.*[\\/]ChristEats[\\/].*/,
  /.*[\\/]apps[\\/]web[\\/].*/,
  /.*[\\/]packages[\\/].*/,
  /.*[\\/]backend[\\/].*/,
  /.*[\\/]ml_service[\\/].*/,
  /.*[\\/]vendor-dashboard[\\/].*/,
  /^(?!.*[\\/]apps[\\/]mobile[\\/]).*[\\/]node_modules[\\/].*/,
];

// Resolve modules only from apps/mobile/node_modules.
config.resolver.nodeModulesPaths = [path.resolve(projectRoot, 'node_modules')];
config.resolver.disableHierarchicalLookup = true;

// Only watch the mobile app folder
config.watchFolders = [projectRoot];

config.projectRoot = projectRoot;
config.server = {
  ...config.server,
  unstable_enableSymlinks: false,
};

module.exports = config;
