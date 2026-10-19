#pragma once
#include <array>
#include <string>
#include <utility>
#include <vector>
namespace gamepack::updates {
enum class HelperPolicy { Blocked, Existing, EmbeddedDefault };
// A process override is permitted only for the all-Undefined Windows client default.
// Explicit policy, including an explicit denial in a lower-precedence scope, is preserved.
inline HelperPolicy selectHelperPolicy(std::vector<std::pair<std::string,std::string>> const& scopes) {
  constexpr std::array<char const*,5> expected{"MachinePolicy","UserPolicy","Process","CurrentUser","LocalMachine"};
  if(scopes.size()!=expected.size())return HelperPolicy::Blocked;
  bool allUndefined=true;
  for(auto const* name:expected) {
    size_t count=0;
    for(auto const& [scope,policy]:scopes) {
      if(scope!=name)continue;
      ++count;
      if(policy=="Restricted" || policy=="AllSigned")return HelperPolicy::Blocked;
      if(policy!="Undefined" && policy!="RemoteSigned" && policy!="Unrestricted" && policy!="Bypass")return HelperPolicy::Blocked;
      allUndefined=allUndefined && policy=="Undefined";
    }
    if(count!=1)return HelperPolicy::Blocked;
  }
  return allUndefined?HelperPolicy::EmbeddedDefault:HelperPolicy::Existing;
}
}
