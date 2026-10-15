#include "../native/shared/PlayerViewport.h"
#include <cassert>

static bool near(double a, double b) { return std::abs(a - b) < 0.000001; }

int main() {
  for (const auto anchor : {gamepack::ViewportAnchor{0, 0}, {0.2, 0.75}, {1, 1}}) {
    const auto offset = gamepack::zoomAt({}, 1, 2, anchor);
    // The source point under the cursor stays at that same screen coordinate.
    assert(near(0.5 + offset.x + (anchor.x - 0.5) * 2, anchor.x));
    assert(near(0.5 + offset.y + (anchor.y - 0.5) * 2, anchor.y));
    const auto reset = gamepack::zoomAt(offset, 2, 1, anchor);
    assert(near(reset.x, 0) && near(reset.y, 0));
    // Discrete wheel interpolation must end at the same place as a pinch.
    auto stepped = gamepack::zoomAt({}, 1, 1.25, anchor);
    stepped = gamepack::zoomAt(stepped, 1.25, 1.5, anchor);
    stepped = gamepack::zoomAt(stepped, 1.5, 2, anchor);
    assert(near(stepped.x, offset.x) && near(stepped.y, offset.y));
  }
  // A new cursor location becomes the focal point for the next gesture.
  auto offset = gamepack::zoomAt({}, 1, 2, {0.2, 0.3});
  const gamepack::ViewportAnchor next{0.7, 0.8};
  const double sourceX = (next.x - 0.5 - offset.x) / 2;
  const double sourceY = (next.y - 0.5 - offset.y) / 2;
  offset = gamepack::zoomAt(offset, 2, 3, next);
  assert(near(0.5 + offset.x + sourceX * 3, next.x));
  assert(near(0.5 + offset.y + sourceY * 3, next.y));
  // Zooming out at a different point cannot expose an edge beyond the footage.
  offset = gamepack::zoomAt(offset, 3, 1.1, {0, 0});
  assert(std::abs(offset.x) <= 0.050001 && std::abs(offset.y) <= 0.050001);
  // Letterboxed dimensions stay centered until they fill the viewport.
  offset = gamepack::zoomAt({}, 1, 1.5, {0, 0}, 1, 0.5);
  assert(near(offset.x, 0.25) && near(offset.y, 0));
  offset = gamepack::zoomAt(offset, 1.5, 4, {0, 0}, 1, 0.5);
  assert(std::abs(offset.y) <= 0.5);
}
