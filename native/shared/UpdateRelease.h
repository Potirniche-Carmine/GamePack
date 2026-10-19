#pragma once
#include <regex>
#include <string>

namespace gamepack::updates {
// External navigation accepts a stable version tag, never a remote URL or path.
// Both desktop hosts use this boundary before handing a URL to the OS browser.
inline std::string releaseUrl(std::string const& tag, std::string const& platform,
                              std::string const& architecture, bool download) {
  static std::regex const stableTag(R"(v?(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(\+[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?)");
  if (tag.size() > 256 || !std::regex_match(tag, stableTag) ||
      (platform != "macos" && platform != "windows") ||
      (architecture != "arm64" && architecture != "x64")) return {};
  std::string url = "https://github.com/Potirniche-Carmine/GamePack/releases/";
  // '+' is encoded so build metadata stays an unambiguous URL path component.
  std::string encodedTag = tag;
  auto plus = encodedTag.find('+');
  if (plus != std::string::npos) encodedTag.replace(plus, 1, "%2B");
  if (!download) return url + "tag/" + encodedTag;
  return url + "download/" + encodedTag + "/GamePack-" + platform + "-" + architecture +
      (platform == "macos" ? ".tar.gz" : ".zip");
}
}
