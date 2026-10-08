const path = require('path');
const {getDefaultConfig, mergeConfig} = require('@react-native/metro-config');
const root = __dirname;
module.exports = mergeConfig(getDefaultConfig(root), {
  resolver: {
    platforms: ['macos', 'windows', 'native'],
    resolveRequest(context, moduleName, platform) {
      if (platform === 'macos' && (moduleName === 'react-native' || moduleName.startsWith('react-native/'))) {
        moduleName = moduleName.replace(/^react-native/, 'react-native-macos');
      }
      if (platform === 'windows' && (moduleName === 'react-native' || moduleName.startsWith('react-native/'))) {
        moduleName = moduleName.replace(/^react-native/, 'react-native-windows');
      }
      return context.resolveRequest(context, moduleName, platform);
    },
    blockList: [/\/target\/.*/, /\/macos\/Pods\/.*/, /\/build\/.*/, /\/\.gamepack\/.*/],
  },
  watchFolders: [path.resolve(root, 'packages')],
});
