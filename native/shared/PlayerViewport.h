#pragma once
#include <algorithm>
#include <cmath>

namespace gamepack {
// Offsets and anchors are fractions of the viewport, so resizing preserves focus.
struct ViewportOffset { double x{0}, y{0}; };
struct ViewportAnchor { double x{0.5}, y{0.5}; };

inline ViewportOffset zoomAt(ViewportOffset offset, double previous, double next,
                             ViewportAnchor anchor, double fittedWidth = 1, double fittedHeight = 1) {
  const double ratio = next / previous;
  const double limitX = std::max(0.0, (fittedWidth * next - 1) / 2);
  const double limitY = std::max(0.0, (fittedHeight * next - 1) / 2);
  return {
    std::clamp((anchor.x - 0.5) * (1 - ratio) + offset.x * ratio, -limitX, limitX),
    std::clamp((anchor.y - 0.5) * (1 - ratio) + offset.y * ratio, -limitY, limitY)
  };
}
} // namespace gamepack
