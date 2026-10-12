const path = require('path');
const {getDefaultConfig, mergeConfig} = require('@react-native/metro-config');
const root = __dirname;
module.exports = mergeConfig(getDefaultConfig(root), {
  resolver: {
    platforms: ['macos', 'windows', 'native'],
    sourceExts: [...getDefaultConfig(root).resolver.sourceExts, 'mjs'],
    resolveRequest(context, moduleName, platform) {
      if (platform === 'macos' && (moduleName === 'react-native' || moduleName.startsWith('react-native/'))) {
        moduleName = moduleName.replace(/^react-native/, 'react-native-macos');
      }
      if (platform === 'windows' && (moduleName === 'react-native' || moduleName.startsWith('react-native/'))) {
        moduleName = moduleName.replace(/^react-native/, 'react-native-windows');
      }
      return context.resolveRequest(context, moduleName, platform);
    },
    blockList: ['target', 'macos/Pods', 'build', '.gamepack'].map(directory =>
      new RegExp(`^${path.resolve(root, directory).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[/\\\\].*`)),
  },
  watchFolders: [path.resolve(root, 'packages')],
});
