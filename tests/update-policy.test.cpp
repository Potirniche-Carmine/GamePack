#include "../apps/windows/GamePack/UpdatePolicy.h"
#include <cassert>
int main() {
  using namespace gamepack::updates;
  std::vector<std::pair<std::string,std::string>> scopes{{"MachinePolicy","Undefined"},{"UserPolicy","Undefined"},{"Process","Undefined"},{"CurrentUser","Undefined"},{"LocalMachine","Undefined"}};
  assert(selectHelperPolicy(scopes)==HelperPolicy::EmbeddedDefault);
  for(size_t index=0;index<scopes.size();++index) {
    for(auto const* denial:{"Restricted","AllSigned","Unknown","Default"}) {
      auto changed=scopes;changed[index].second=denial;
      assert(selectHelperPolicy(changed)==HelperPolicy::Blocked);
    }
    for(auto const* permitted:{"RemoteSigned","Unrestricted","Bypass"}) {
      auto changed=scopes;changed[index].second=permitted;
      assert(selectHelperPolicy(changed)==HelperPolicy::Existing);
    }
  }
  auto explicitDeny=scopes;explicitDeny[2].second="Bypass";explicitDeny[4].second="Restricted";
  assert(selectHelperPolicy(explicitDeny)==HelperPolicy::Blocked);
  auto groupDeny=scopes;groupDeny[0].second="AllSigned";groupDeny[3].second="Unrestricted";
  assert(selectHelperPolicy(groupDeny)==HelperPolicy::Blocked);
  auto duplicate=scopes;duplicate[0].first="UserPolicy";
  assert(selectHelperPolicy(duplicate)==HelperPolicy::Blocked);
  scopes.pop_back();assert(selectHelperPolicy(scopes)==HelperPolicy::Blocked);
}
