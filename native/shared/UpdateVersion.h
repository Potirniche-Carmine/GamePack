#pragma once
#include <optional>
#include <regex>
#include <string>
#include <utility>

namespace gamepack::updates {
struct StableVersion {
  std::string major, minor, patch;
  std::string normalized() const { return major + "." + minor + "." + patch; }
};
inline std::optional<StableVersion> parseStableVersion(std::string const& value) {
  static std::regex const pattern(R"(v?(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(\+[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?)");
  std::smatch match;
  if (value.size() > 256 || !std::regex_match(value, match, pattern)) return std::nullopt;
  return StableVersion{match[1], match[2], match[3]};
}
inline bool newerStableVersion(std::string const& candidate, std::string const& installed) {
  auto a = parseStableVersion(candidate), b = parseStableVersion(installed);
  if (!a || !b) return false;
  for (auto pair : {std::pair{a->major, b->major}, std::pair{a->minor, b->minor}, std::pair{a->patch, b->patch}}) {
    if (pair.first.size() != pair.second.size()) return pair.first.size() > pair.second.size();
    if (pair.first != pair.second) return pair.first > pair.second;
  }
  return false;
}
}
