#include "../native/shared/UpdateArchiveLimits.h"
#include <cassert>
#include <limits>

int main() {
  using gamepack::updates::acceptArchiveBytes;
  constexpr uint64_t block = 512ULL * 1024 * 1024;
  uint64_t expanded = 0;
  for (int n = 0; n < 4; ++n) assert(acceptArchiveBytes(expanded, block));
  assert(expanded == 4 * block);
  assert(!acceptArchiveBytes(expanded, 1));
  assert(expanded == 4 * block);
  expanded = 0;
  assert(!acceptArchiveBytes(expanded, block + 1));
  assert(!acceptArchiveBytes(expanded, std::numeric_limits<uint64_t>::max()));
  assert(expanded == 0);
  expanded = std::numeric_limits<uint64_t>::max();
  assert(!acceptArchiveBytes(expanded, 0));
  expanded = 4 * block - 1;
  assert(acceptArchiveBytes(expanded, 1));
  assert(acceptArchiveBytes(expanded, 0));
}
