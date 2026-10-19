#include "../native/shared/UpdateVersion.h"
#include <cassert>
int main() {
  using namespace gamepack::updates;
  assert(parseStableVersion("v1.2.3+build.4")->normalized() == "1.2.3");
  assert(newerStableVersion("v1.10.0", "1.9.99"));
  assert(newerStableVersion("9007199254740993.0.0", "9007199254740992.0.0"));
  assert(!newerStableVersion("v1.0.0+new", "1.0.0"));
  assert(!newerStableVersion("v0.1.3", "1.0.0"));
  for (auto bad : {"1.0", "01.0.0", "v1.0.0-beta", "v1.0.0\n", "1.0.0/../../other", "1.0.0+", "1.0.0+meta..data"}) assert(!parseStableVersion(bad));
}
