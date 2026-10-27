#include "../native/shared/UpdateInstallation.h"
#include <cassert>

int main() {
  using gamepack::updates::supportedMacInstallation;
  const std::string root = "/Volumes/Library with spaces", home = "/Users/reviewer";
  for (auto const& app : {root + "/app/GamePack.app", home + "/Applications/GamePack.app", std::string("/Applications/GamePack.app")})
    assert(supportedMacInstallation(root, home, app));
  for (auto const& app : {home + "/Downloads/GamePack.app", std::string("/Volumes/GamePack/GamePack.app"), home + "/Applications/Other.app",
      home + "/Applications/GamePack.app/Contents", std::string("/Applications/GamePack.app.backup"), std::string("/Users/other/Applications/GamePack.app")})
    assert(!supportedMacInstallation(root, home, app));
}
