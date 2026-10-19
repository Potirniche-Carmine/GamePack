#pragma once
#include <algorithm>
#include <cstdint>
#include <vector>

namespace gamepack {
struct InkSample { double x, y; int64_t time; };

// Source time, never elapsed wall time: pause, speed changes and reverse seeks
// all reconstruct the same visible ink. Equal-time samples appear together.
inline std::vector<InkSample> visibleInk(std::vector<InkSample> const& samples, int64_t time, bool timed) {
  if (!timed) return samples;
  auto next = std::upper_bound(samples.begin(), samples.end(), time,
    [](int64_t t, InkSample const& sample) { return t < sample.time; });
  std::vector<InkSample> visible(samples.begin(), next);
  if (!visible.empty() && next != samples.end()) {
    auto last = visible.back();
    if (time > last.time && next->time > last.time) {
      double progress = static_cast<double>(time - last.time) / static_cast<double>(next->time - last.time);
      visible.push_back({last.x + (next->x - last.x) * progress, last.y + (next->y - last.y) * progress, time});
    }
  }
  return visible;
}
}
