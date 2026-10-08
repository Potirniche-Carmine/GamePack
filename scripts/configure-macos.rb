require 'xcodeproj'
project = Xcodeproj::Project.open(File.join(__dir__, '../macos/gamepack.xcodeproj'))
target = project.targets.find { |t| t.name == 'gamepack-macOS' }
abort 'macOS target missing' unless target
group = project.main_group.find_subpath('GamePack Native', true)
group.set_source_tree('<group>')
%w[GamePackModule.mm GamePackPlayer.mm].each do |name|
  path = "../native/macos/#{name}"
  ref = group.files.find { |f| f.path == path } || group.new_file(path)
  target.source_build_phase.add_file_reference(ref, true)
end
target.build_configurations.each do |config|
  s = config.build_settings
  s['PRODUCT_NAME'] = 'GamePack'
  s['PRODUCT_BUNDLE_IDENTIFIER'] = 'app.gamepack.desktop'
  s['MACOSX_DEPLOYMENT_TARGET'] = '14.0'
  s['ENABLE_APP_SANDBOX'] = 'NO'
  s['ENABLE_USER_SCRIPT_SANDBOXING'] = 'NO'
  s['CODE_SIGN_IDENTITY'] = '-'
  s['CODE_SIGN_STYLE'] = 'Manual'
  s['HEADER_SEARCH_PATHS'] = ['$(inherited)', '$(SRCROOT)/../target/cxxbridge']
  s['LIBRARY_SEARCH_PATHS'] = ['$(inherited)', '$(SRCROOT)/../target/release']
  s['OTHER_LDFLAGS'] = ['$(inherited)', '-ObjC', '-lc++', '-lgamepack_core', '-framework', 'AVFoundation', '-framework', 'Security', '-framework', 'SystemConfiguration']
end
project.save
