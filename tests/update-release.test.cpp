#include "../native/shared/UpdateRelease.h"
#include <cassert>

int main() {
  using gamepack::updates::releaseUrl;
  for (auto platform : {"macos", "windows"}) {
    for (auto architecture : {"arm64", "x64"}) {
      const std::string asset = std::string("GamePack-") + platform + "-" + architecture + (std::string(platform) == "macos" ? ".tar.gz" : ".zip");
      assert(releaseUrl("v1.2.3", platform, architecture, true) == "https://github.com/Potirniche-Carmine/GamePack/releases/download/v1.2.3/" + asset);
    }
  }
  assert(releaseUrl("1.2.3+build.4", "macos", "x64", false) == "https://github.com/Potirniche-Carmine/GamePack/releases/tag/1.2.3%2Bbuild.4");
  assert(releaseUrl("v0.1.3", "windows", "arm64", false) == "https://github.com/Potirniche-Carmine/GamePack/releases/tag/v0.1.3");
  for (std::string tag : {"", "01.2.3", "v1.2.3-beta", "v1.2.3\n", "v1.2.3/../../elsewhere", "https://evil.example", "v1.2.3?host=evil", "v1.2.3#fragment", "v1.2.3%2Fother", "v1.2.3+", "v1.2.3+meta..data", "v1.2.3\\evil"}) {
    assert(releaseUrl(tag, "macos", "arm64", true).empty());
    assert(releaseUrl(tag, "windows", "x64", false).empty());
  }
  assert(releaseUrl("1.2.3+" + std::string(256, 'a'), "macos", "arm64", true).empty());
  assert(releaseUrl("1.2.3", "linux", "x64", true).empty());
  assert(releaseUrl("1.2.3", "macos", "../x64", true).empty());
}
