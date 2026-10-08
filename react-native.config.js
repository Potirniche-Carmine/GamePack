const isWindows = process.platform === 'win32';
module.exports = {
  reactNativePath: isWindows ? './node_modules/react-native' : './node_modules/react-native-macos',
  project: isWindows ? {windows: {sourceDir: './apps/windows'}} : {macos: {sourceDir: './macos'}},
  dependencies: {'react-native-windows': {platforms: {macos: null, ios: null, android: null}}},
};
