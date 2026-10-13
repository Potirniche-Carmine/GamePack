require 'yaml'

expected, actual = ARGV.map { |path| YAML.load_file(path) }
# Local React Native podspecs reflect the runner's tooling. Only their generated
# checksums may change; dependency versions, sources, and the Podfile must match.
expected.delete('SPEC CHECKSUMS')
actual.delete('SPEC CHECKSUMS')
abort 'CocoaPods dependency lock drifted; review Podfile.lock explicitly.' unless expected == actual
