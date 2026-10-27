#pragma once
#include <string>

namespace gamepack::updates {
// Callers resolve and verify canonical paths before applying this allowlist.
inline bool supportedMacInstallation(std::string const& root, std::string const& home, std::string const& app) {
  return app == root + "/app/GamePack.app" || app == home + "/Applications/GamePack.app" || app == "/Applications/GamePack.app";
}
}
