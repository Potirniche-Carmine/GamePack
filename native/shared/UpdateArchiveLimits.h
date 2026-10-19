#pragma once
#include <cstdint>

namespace gamepack::updates {
// Checked before reading or allocating an archive entry, independently of the
// compressed download size. Subtraction keeps malformed sizes from wrapping.
inline bool acceptArchiveBytes(uint64_t &expanded, uint64_t entrySize) {
  constexpr uint64_t fileLimit = 512ULL * 1024 * 1024;
  constexpr uint64_t totalLimit = 2ULL * 1024 * 1024 * 1024;
  if (entrySize > fileLimit || expanded > totalLimit || entrySize > totalLimit - expanded) return false;
  expanded += entrySize;
  return true;
}
}
