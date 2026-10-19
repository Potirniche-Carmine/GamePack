#include "pch.h"
#include <winrt/Windows.UI.ViewManagement.h>
#include "GamePackPlayer.h"
#include "../../../native/shared/PlayerViewport.h"
#include "../../../native/shared/AnnotationTiming.h"
using namespace winrt;
using namespace Windows::Foundation;
using namespace Windows::Data::Json;
using namespace Windows::UI;
using namespace Windows::UI::Xaml;
using namespace Windows::UI::Xaml::Controls;
using namespace Windows::UI::Xaml::Media;
using namespace Windows::UI::Xaml::Shapes;
using namespace Microsoft::ReactNative;
namespace gamepack::windows {
FrameworkElement GlassManager::CreateView() noexcept { Border view; view.Tag(box_value(false)); return view; }
auto GlassManager::NativeProps() noexcept -> Windows::Foundation::Collections::IMapView<hstring,ViewManagerPropertyType> {
  return single_threaded_map<hstring,ViewManagerPropertyType>(std::map<hstring,ViewManagerPropertyType>{{L"dark",ViewManagerPropertyType::Boolean},{L"desktop",ViewManagerPropertyType::Boolean},{L"cornerRadius",ViewManagerPropertyType::Number}}).GetView();
}
void GlassManager::UpdateProperties(FrameworkElement const& view,IJSValueReader const& reader) noexcept {
  auto props=JSValueObject::ReadFrom(reader);
  if (auto it=props.find("cornerRadius"); it!=props.end()) view.as<Border>().CornerRadius(CornerRadius{it->second.AsDouble()});
  if (auto it=props.find("desktop"); it!=props.end()) view.Tag(box_value(it->second.AsBoolean()));
  if (auto it=props.find("dark"); it!=props.end()) view.RequestedTheme(it->second.AsBoolean() ? ElementTheme::Dark : ElementTheme::Light);
  if (props.count("dark") || props.count("desktop")) {
    bool dark=view.RequestedTheme()==ElementTheme::Dark;
    AcrylicBrush brush;
    brush.BackgroundSource(unbox_value<bool>(view.Tag()) ? AcrylicBackgroundSource::HostBackdrop : AcrylicBackgroundSource::Backdrop);
    brush.TintColor(dark ? Color{255,30,32,38} : Color{255,250,250,252});
    brush.TintOpacity(dark ? .42 : .38);
    brush.FallbackColor(dark ? Color{255,36,38,44} : Color{255,245,246,248});
    view.as<Border>().Background(brush);
  }
}
static double Number(JsonObject const& object, wchar_t const* key, double fallback = 0) { return object.GetNamedNumber(key, fallback); }
static JsonValue N(double value) { return JsonValue::CreateNumberValue(value); }
static JsonValue S(hstring const& value) { return JsonValue::CreateStringValue(value); }
static constexpr double scale = 1000000.0;
static void* ViewKey(FrameworkElement const& view) { return get_abi(view.as<Windows::Foundation::IInspectable>()); }
struct PlayerState : std::enable_shared_from_this<PlayerState> {
  Grid root;
  MediaPlayerElement element;
  Canvas overlay;
  CompositeTransform zoomTransform;
  gamepack::ViewportOffset zoomOffset;
  gamepack::ViewportAnchor zoomAnchor;
  RectangleGeometry viewportClip;
  Windows::Media::Playback::MediaPlayer player;
  DispatcherTimer timer;
  Microsoft::ReactNative::ReactContext context;
  JsonObject scene{nullptr}, stroke{nullptr};
  JsonArray samples{nullptr};
  std::map<hstring, JsonObject> pendingDrawings;
  std::string readyKey, presentedSceneKey;
  std::chrono::steady_clock::time_point lastActivity{};
  UIElement activityRoot{nullptr};
  event_token activityToken{};
  hstring tool{L"pointer"}, source;
  int64_t seekToken{-1}, seekUs{}, reviewEnd{-1}, flushToken{}, flushRequest{};
  std::string flushDrawing;
  bool paused{true}, ended{}, capturing{}, disposed{}, seeking{}, seekInFlight{}, applyingProps{}, settlingReviewStop{};
  uint64_t sourceGeneration{}, seekGeneration{}, activeSeekGeneration{};
  int64_t pendingSeekTarget{}, stepFrames{1}, stepToken{};
  double frameRate{}, rate{1}, zoom{1}, requestedZoom{1}, zoomTarget{1};
  int64_t zoomToken{-1};
  std::chrono::steady_clock::time_point zoomTick{};
  bool reverseSeek{};
  std::chrono::steady_clock::time_point reverseTick{};
  event_token seekCompletedToken{};
  std::chrono::steady_clock::time_point lastEmit{};
  event_token timerToken{}, openedToken{}, endedToken{}, failedToken{};
  explicit PlayerState(IReactContext const& ctx) : context(ctx) {
    root.Background(SolidColorBrush(Colors::Black()));
    root.Children().Append(element);
    root.Children().Append(overlay);
    element.AreTransportControlsEnabled(false);
    element.Stretch(Stretch::Uniform);
    element.RenderTransform(zoomTransform);
    root.Clip(viewportClip);
    player.AutoPlay(false);
    player.IsVideoFrameServerEnabled(false);
    element.SetMediaPlayer(player);
    overlay.Background(SolidColorBrush(Colors::Transparent()));
    overlay.IsHitTestVisible(true);
  }
  int64_t Time() { return std::max<int64_t>(0, player.PlaybackSession().Position().count() / 10); }
  int64_t Duration() { return std::max<int64_t>(0, player.PlaybackSession().NaturalDuration().count() / 10); }
  Rect ContentRect() {
    double w = root.ActualWidth(), h = root.ActualHeight();
    auto session = player.PlaybackSession();
    double vw = session.NaturalVideoWidth(), vh = session.NaturalVideoHeight();
    if (vw <= 0 || vh <= 0 || w <= 0 || h <= 0) return Rect{0, 0, 0, 0};
    double fit = std::min(w / vw, h / vh) * zoom;
    return Rect{static_cast<float>((w-vw*fit)/2 + zoomOffset.x*w), static_cast<float>((h-vh*fit)/2 + zoomOffset.y*h), static_cast<float>(vw*fit), static_cast<float>(vh*fit)};
  }
  void UpdateViewport() {
    double width=root.ActualWidth(), height=root.ActualHeight();
    zoomTransform.CenterX(width/2); zoomTransform.CenterY(height/2);
    zoomTransform.ScaleX(zoom); zoomTransform.ScaleY(zoom);
    zoomTransform.TranslateX(zoomOffset.x*width); zoomTransform.TranslateY(zoomOffset.y*height);
    viewportClip.Rect(Rect{0,0,static_cast<float>(width),static_cast<float>(height)});
  }
  void SetZoom(double value, bool notify=false) {
    value=std::isfinite(value) ? std::clamp(value,1.0,4.0) : 1;
    if (std::abs(value-zoom)<0.00001) return;
    Finish();
    auto rect=ContentRect();
    zoomOffset=gamepack::zoomAt(zoomOffset,zoom,value,zoomAnchor,
      rect.Width/zoom/std::max(1.0,root.ActualWidth()),rect.Height/zoom/std::max(1.0,root.ActualHeight()));
    zoom=value; UpdateViewport(); Render();
    if (notify) context.DispatchEvent(root,L"topZoom",JSValueObject{{"zoom",zoom},{"zoomToken",zoomToken}});
  }
  void AnimateZoom() {
    auto now=std::chrono::steady_clock::now();
    double elapsed=std::clamp(std::chrono::duration<double>(now-zoomTick).count(),0.0,0.05);
    zoomTick=now;
    if (std::abs(zoomTarget-zoom)<0.00001) return;
    double next=zoom+(zoomTarget-zoom)*(1-std::exp(-elapsed/0.035));
    if (std::abs(next-zoomTarget)<0.0005) next=zoomTarget;
    SetZoom(next,true);
  }
  void ResetSeek() {
    ++seekGeneration;
    if (seekInFlight) player.PlaybackSession().SeekCompleted(seekCompletedToken);
    seekInFlight=false;
  }
  void CompleteSeek(uint64_t generation) {
    if (disposed || !seekInFlight || generation!=activeSeekGeneration) return;
    player.PlaybackSession().SeekCompleted(seekCompletedToken);
    seekInFlight=false;
    // Serialize native seeks: an older completion cannot release a newer request.
    if (generation!=seekGeneration) { StartSeek(); return; }
    seeking=false; settlingReviewStop=false;
    if (flushRequest) StrokeFlush();
    else if (!paused && !reverseSeek) player.Play();
    Render(); Emit(true);
  }
  void StartSeek() {
    if (disposed || seekInFlight || Duration()<=0) return;
    auto target=std::clamp<int64_t>(pendingSeekTarget,0,Duration());
    auto generation=seekGeneration;
    if (Time()==target) { seeking=false; settlingReviewStop=false; if (flushRequest) StrokeFlush(); else if (!paused && !reverseSeek) player.Play(); Render(); Emit(true); return; }
    seekInFlight=true; activeSeekGeneration=generation;
    auto weak=weak_from_this();
    seekCompletedToken=player.PlaybackSession().SeekCompleted([weak,generation](auto const&,auto const&) {
      if (auto self=weak.lock()) self->root.Dispatcher().RunAsync(Windows::UI::Core::CoreDispatcherPriority::Normal,[weak,generation] {
        if (auto p=weak.lock()) p->CompleteSeek(generation);
      });
    });
    player.PlaybackSession().Position(std::chrono::microseconds(target));
  }
  void Seek(int64_t target, bool reviewStop=false) {
    Finish(); ++seekGeneration; pendingSeekTarget=target; seeking=true; settlingReviewStop=reviewStop;
    player.Pause(); StartSeek();
  }
  bool TimedCapture() { return scene && scene.GetNamedObject(L"anchor",JsonObject{}).GetNamedString(L"kind",L"point")==L"play"; }
  bool AnchorVisible(JsonObject const& anchor, bool capture=false) {
    auto t=Time(), start=static_cast<int64_t>(Number(anchor,L"at_us"));
    if (anchor.GetNamedString(L"kind",L"point")==L"play") {
      auto end=static_cast<int64_t>(capture ? Number(scene,L"captureEndUs") : Number(anchor,L"end_us"));
      return t>=start-2000 && t<=end+2000;
    }
    return paused && std::abs(t-start)<=2000;
  }
  bool CanAnnotate() {
    if (disposed || seeking || !scene || source.empty() || Duration()<=0) return false;
    auto anchor=scene.GetNamedObject(L"anchor",JsonObject{});
    return AnchorVisible(anchor,true) && (!TimedCapture() || rate>0);
  }
  void Emit(bool force = false, std::string error = {}) {
    if (seeking && error.empty()) return;
    auto now = std::chrono::steady_clock::now();
    if (!force && now-lastEmit < std::chrono::milliseconds(80)) return;
    lastEmit = now;
    auto session = player.PlaybackSession();
    context.DispatchEvent(root, L"topTime", JSValueObject{
      {"time_us", Time()}, {"duration_us", Duration()},
      {"width", static_cast<int64_t>(session.NaturalVideoWidth())},
      {"height", static_cast<int64_t>(session.NaturalVideoHeight())},
      {"seekToken", seekToken},
      {"playing", session.PlaybackState() == Windows::Media::Playback::MediaPlaybackState::Playing},
      {"ended", ended}, {"error", std::move(error)}});
  }
  void Init() {
    auto weak = weak_from_this();
    timer.Interval(std::chrono::milliseconds(16));
    timerToken = timer.Tick([weak](auto const&, auto const&) {
      if (auto self=weak.lock(); self && !self->disposed) self->AnimateZoom();
      if (auto self = weak.lock(); self && !self->disposed && !self->seeking) {
        // Reserve one dispatcher tick to settle the exact frame before crossing it.
        auto lead=static_cast<int64_t>(20000*std::abs(self->rate));
        if (self->reviewEnd >= 0 && !self->paused && (self->rate < 0 ? self->Time()-lead <= self->reviewEnd : self->Time()+lead >= self->reviewEnd)) {
          self->Finish(); self->player.Pause(); self->paused = true;
          self->ended = true; self->Seek(self->reviewEnd, true); self->Render(); return;
        }
        if (self->reverseSeek && !self->paused) {
          auto now=std::chrono::steady_clock::now();
          double elapsed=std::chrono::duration<double>(now-self->reverseTick).count();
          if (elapsed>=0.08) {
            self->reverseTick=now;
            auto target=std::max<int64_t>(0,self->Time()+static_cast<int64_t>(std::min(elapsed,0.25)*self->rate*1000000));
            if (self->reviewEnd>=0 && target<=self->reviewEnd) {
              self->paused=true; self->ended=true; self->Seek(self->reviewEnd,true); return;
            }
            if (target==0) { self->paused=true; self->ended=true; }
            self->Seek(target); return;
          }
        }
        self->Render(); self->Emit();
      }
    });
    openedToken = player.MediaOpened([weak](auto const&, auto const&) { if (auto self = weak.lock()) {
      self->root.Dispatcher().RunAsync(Windows::UI::Core::CoreDispatcherPriority::Normal, [weak] {
        if (auto p = weak.lock(); p && !p->disposed) { p->Seek(p->seekUs); }
      });
    }});
    endedToken = player.MediaEnded([weak](auto const&, auto const&) { if (auto self = weak.lock()) {
      self->root.Dispatcher().RunAsync(Windows::UI::Core::CoreDispatcherPriority::Normal, [weak] {
        if (auto p = weak.lock(); p && !p->disposed && !p->seeking) { p->ended = true; p->paused = true; p->Finish(); p->Emit(true); }
      });
    }});
    failedToken = player.MediaFailed([weak](auto const&, auto const& args) { if (auto self = weak.lock()) {
      auto message = to_string(args.ErrorMessage());
      self->root.Dispatcher().RunAsync(Windows::UI::Core::CoreDispatcherPriority::Normal, [weak, message] {
        if (auto p = weak.lock(); p && !p->disposed) p->Emit(true, "Windows could not decode this video: " + message);
      });
    }});
    root.SizeChanged([weak](auto const&, auto const&) { if (auto self = weak.lock()) { self->UpdateViewport(); self->Render(); } });
    overlay.PointerPressed([weak](auto const&, Windows::UI::Xaml::Input::PointerRoutedEventArgs const& args) {
      if (auto self = weak.lock(); self && (self->tool == L"pointer" || self->tool == L"laser")) {
        auto point = args.GetCurrentPoint(self->overlay);
        if (!point.Properties().IsLeftButtonPressed() && point.PointerDevice().PointerDeviceType() == Windows::Devices::Input::PointerDeviceType::Mouse) return;
        auto p = point.Position();
        self->context.DispatchEvent(self->root,L"topPointer",JSValueObject{{"x",p.X/std::max(1.0,self->root.ActualWidth())},{"y",p.Y/std::max(1.0,self->root.ActualHeight())}});
        args.Handled(true); return;
      }
      if (auto self = weak.lock(); self && self->tool != L"none" && self->CanAnnotate()) {
        auto point = args.GetCurrentPoint(self->overlay);
        auto r = self->ContentRect(); auto p = point.Position();
        if (r.Width <= 0 || p.X < r.X || p.Y < r.Y || p.X > r.X+r.Width || p.Y > r.Y+r.Height) return;
        if (!point.Properties().IsLeftButtonPressed() && point.PointerDevice().PointerDeviceType() == Windows::Devices::Input::PointerDeviceType::Mouse) return;
        self->Finish(); self->capturing = true;
        if (!self->TimedCapture()) { self->player.Pause(); self->paused = true; }
        self->overlay.CapturePointer(args.Pointer());
        self->samples = JsonArray{}; self->stroke = JsonObject{};
        GUID guid{}; CoCreateGuid(&guid); wchar_t id[40]{}; StringFromGUID2(guid, id, 40);
        self->stroke.SetNamedValue(L"id", S(hstring(id + 1, 36))); self->stroke.SetNamedValue(L"tool", S(self->tool));
        self->stroke.SetNamedValue(L"width", N(3500));
        self->stroke.SetNamedValue(L"samples", self->samples);
        self->Sample(p); self->Render(); args.Handled(true);
        self->context.DispatchEvent(self->root,L"topDrawingStart",JSValueObject{{"time_us",self->Time()},{"paused",self->paused}});
      }
    });
    overlay.PointerMoved([weak](auto const&, Windows::UI::Xaml::Input::PointerRoutedEventArgs const& args) { if (auto self=weak.lock()) {
      auto now=std::chrono::steady_clock::now();
      if (now-self->lastActivity>std::chrono::milliseconds(120)) { self->lastActivity=now; self->context.DispatchEvent(self->root,L"topActivity",JSValueObject{}); }
      if (self->capturing) { self->Sample(args.GetCurrentPoint(self->overlay).Position()); self->Render(); args.Handled(true); }
    }});
    overlay.PointerReleased([weak](auto const&, Windows::UI::Xaml::Input::PointerRoutedEventArgs const& args) { if (auto self=weak.lock(); self && self->capturing) {
      self->Sample(args.GetCurrentPoint(self->overlay).Position()); self->Finish(); args.Handled(true);
    }});
    overlay.PointerCanceled([weak](auto const&, auto const&) { if (auto self=weak.lock()) self->Finish(); });
    overlay.PointerCaptureLost([weak](auto const&, auto const&) { if (auto self=weak.lock()) self->Finish(); });
    overlay.PointerWheelChanged([weak](auto const&, Windows::UI::Xaml::Input::PointerRoutedEventArgs const& args) {
      if (auto self=weak.lock(); self && !self->source.empty()) {
        auto point=args.GetCurrentPoint(self->overlay);
        auto properties=point.Properties();
        if (properties.IsHorizontalMouseWheel()) return;
        auto position=point.Position();
        self->zoomAnchor={position.X/std::max(1.0,self->root.ActualWidth()),position.Y/std::max(1.0,self->root.ActualHeight())};
        self->zoomTarget=std::clamp(self->zoomTarget*std::pow(1.1,properties.MouseWheelDelta()/120.0),1.0,4.0);
        if (!Windows::UI::ViewManagement::UISettings{}.AnimationsEnabled()) self->SetZoom(self->zoomTarget,true);
        args.Handled(true);
      }
    });
    root.Loaded([weak](auto const&, auto const&) { if (auto self=weak.lock()) {
      self->timer.Start();
      if (!self->activityRoot && self->root.XamlRoot()) {
        self->activityRoot=self->root.XamlRoot().Content();
        self->activityToken=self->activityRoot.PointerMoved([weak](auto const&, auto const&) {
          if (auto p=weak.lock()) {
            auto now=std::chrono::steady_clock::now();
            if (now-p->lastActivity>std::chrono::milliseconds(120)) { p->lastActivity=now; p->context.DispatchEvent(p->root,L"topActivity",JSValueObject{}); }
          }
        });
      }
    }});
    root.Unloaded([weak](auto const&, auto const&) { if (auto self=weak.lock()) { self->StopActivity(); self->timer.Stop(); self->Finish(); self->player.Pause(); } });
    timer.Start();
  }
  void Sample(Point p) {
    if (!capturing || !samples) return;
    if (!CanAnnotate()) { Finish(); return; }
    auto r=ContentRect(); if (r.Width <= 0 || r.Height <= 0) return;
    if (samples.Size() >= 50000) { Finish(); return; }
    JsonObject sample;
    sample.SetNamedValue(L"x", N(std::round(std::clamp((p.X-r.X)/r.Width, 0.0f, 1.0f)*scale)));
    sample.SetNamedValue(L"y", N(std::round(std::clamp((p.Y-r.Y)/r.Height, 0.0f, 1.0f)*scale)));
    if (TimedCapture()) {
      auto anchor=scene.GetNamedObject(L"anchor",JsonObject{});
      auto start=static_cast<int64_t>(Number(anchor,L"at_us")), end=static_cast<int64_t>(Number(scene,L"captureEndUs"));
      auto previous=samples.Size() ? static_cast<int64_t>(Number(samples.GetAt(samples.Size()-1).GetObject(),L"t_us")) : start;
      sample.SetNamedValue(L"t_us",N(std::max(previous,std::clamp(Time(),start,end))));
    }
    samples.Append(sample);
  }
  std::string Finish(bool notify=true) {
    if (!capturing) return {};
    capturing=false;
    overlay.ReleasePointerCaptures();
    if (stroke && samples && samples.Size()) {
      if (stroke.GetNamedString(L"tool", L"pen") != L"pen") {
        JsonArray endpoints;
        endpoints.Append(samples.GetAt(0));
        endpoints.Append(samples.GetAt(samples.Size()-1));
        stroke.SetNamedValue(L"samples", endpoints);
      }
      pendingDrawings[stroke.GetNamedString(L"id")]=stroke;
      auto json=to_string(stroke.Stringify());
      if (flushRequest) flushDrawing=json;
      else if (notify) context.DispatchEvent(root, L"topDrawing", JSValueObject{{"drawingJson",json}});
      stroke=nullptr; samples=nullptr; Render();
      return json;
    }
    stroke=nullptr; samples=nullptr; Render();
    return {};
  }
  void StrokeFlush() {
    if (!flushRequest || disposed || seeking || applyingProps) return;
    paused=true; player.Pause();
    // Finish uses the pending request to put this stroke exclusively in the ACK.
    Finish(false);
    auto token=flushRequest;
    flushRequest=0;
    JSValueObject result{{"flushToken",token},{"time_us",Time()}};
    if (!flushDrawing.empty()) result["drawingJson"]=std::move(flushDrawing);
    flushDrawing.clear();
    context.DispatchEvent(root,L"topStrokeFlushFinished",std::move(result));
  }
  void StopActivity() {
    if (activityRoot) { activityRoot.PointerMoved(activityToken); activityRoot=nullptr; }
  }
  void Dispose() {
    if (disposed) return;
    StopActivity(); Finish(); ResetSeek(); disposed=true; timer.Stop(); timer.Tick(timerToken);
    player.MediaOpened(openedToken); player.MediaEnded(endedToken); player.MediaFailed(failedToken);
    player.Pause(); player.Close();
  }
  static fire_and_forget Load(std::weak_ptr<PlayerState> weak, hstring path, uint64_t generation) {
    try {
      auto file = co_await Windows::Storage::StorageFile::GetFileFromPathAsync(path);
      double frameRate=0;
      try {
        auto properties=co_await file.Properties().RetrievePropertiesAsync(single_threaded_vector<hstring>({L"System.Video.FrameRate"}));
        if (properties.HasKey(L"System.Video.FrameRate")) frameRate=unbox_value<uint32_t>(properties.Lookup(L"System.Video.FrameRate"))/1000.0;
      } catch (...) { /* Forward stepping still uses the native decoded frame. */ }
      if (auto self=weak.lock(); self && !self->disposed && generation==self->sourceGeneration) {
        self->frameRate=frameRate;
        self->player.Source(Windows::Media::Core::MediaSource::CreateFromStorageFile(file));
      }
    } catch (hresult_error const& error) {
      if (auto self=weak.lock(); self && !self->disposed && generation==self->sourceGeneration) self->Emit(true,to_string(error.message()));
    }
  }
  void Draw(JsonObject const& drawing) {
    auto r=ContentRect(); if (r.Width <= 0) return;
    auto list=drawing.GetNamedArray(L"samples",JsonArray{});
    auto anchor=drawing.GetNamedObject(L"anchor",scene.GetNamedObject(L"anchor",JsonObject{}));
    if (!AnchorVisible(anchor,!drawing.HasKey(L"anchor") && scene.GetNamedBoolean(L"capture",false))) return;
    auto type=drawing.GetNamedString(L"tool",L"pen");
    std::vector<gamepack::InkSample> samples;
    for (auto const& item:list) {
      auto sample=item.GetObject();
      samples.push_back({Number(sample,L"x"),Number(sample,L"y"),static_cast<int64_t>(Number(sample,L"t_us"))});
    }
    auto visible=gamepack::visibleInk(samples,std::max(Time(),static_cast<int64_t>(Number(anchor,L"at_us"))),anchor.GetNamedString(L"kind",L"point")==L"play");
    std::vector<Point> points;
    for (auto const& sample:visible) points.push_back(Point{r.X+static_cast<float>(sample.x/scale*r.Width),r.Y+static_cast<float>(sample.y/scale*r.Height)});
    if (points.empty()) return;
    SolidColorBrush brush(Color{255,121,191,253}); brush.Opacity(Number(drawing,L"opacity",1));
    double thickness=std::max(1.0,Number(drawing,L"width",3500)/scale*r.Width);
    auto a=points.front(), b=points.back();
    auto addLine=[&](std::vector<Point> const& p) {
      Windows::UI::Xaml::Shapes::Polyline line; line.Stroke(brush); line.StrokeThickness(thickness); line.StrokeStartLineCap(PenLineCap::Round); line.StrokeEndLineCap(PenLineCap::Round); line.StrokeLineJoin(PenLineJoin::Round);
      for (auto const& point:p) line.Points().Append(point);
      overlay.Children().Append(line);
    };
    if (type==L"ellipse") {
      Windows::UI::Xaml::Shapes::Ellipse shape; shape.Stroke(brush); shape.StrokeThickness(thickness);
      shape.Width(std::max(1.0f,std::abs(a.X-b.X))); shape.Height(std::max(1.0f,std::abs(a.Y-b.Y)));
      Canvas::SetLeft(shape,std::min(a.X,b.X)); Canvas::SetTop(shape,std::min(a.Y,b.Y)); overlay.Children().Append(shape);
    } else if (type==L"arrow") {
      addLine({a,b}); double angle=std::atan2(b.Y-a.Y,b.X-a.X), size=std::max(12.0,thickness*4);
      addLine({Point{b.X-static_cast<float>(size*std::cos(angle-0.5)),b.Y-static_cast<float>(size*std::sin(angle-0.5))},b,Point{b.X-static_cast<float>(size*std::cos(angle+0.5)),b.Y-static_cast<float>(size*std::sin(angle+0.5))}});
    } else if (points.size()==1) {
      Windows::UI::Xaml::Shapes::Ellipse dot; dot.Fill(brush); dot.Width(thickness); dot.Height(thickness);
      Canvas::SetLeft(dot,a.X-thickness/2); Canvas::SetTop(dot,a.Y-thickness/2); overlay.Children().Append(dot);
    } else addLine(points);
  }
  void Render() {
    if (disposed) return;
    overlay.Children().Clear();
    if (seeking) { readyKey.clear(); return; }
    if (!scene) readyKey.clear();
    if (scene) {
      auto anchor=scene.GetNamedObject(L"anchor",JsonObject{});
      bool ready=false;
      if (scene.HasKey(L"anchors")) {
        for (auto const& value:scene.GetNamedArray(L"anchors")) if (AnchorVisible(value.GetObject())) { ready=true; break; }
      } else ready=AnchorVisible(anchor,scene.GetNamedBoolean(L"capture",false));
      if (ready) {
        auto drawings=scene.GetNamedArray(L"drawings",JsonArray{});
        auto key=to_string(scene.GetNamedString(L"id",L""))+":"+std::to_string(seekToken)+":"+std::to_string(stepToken);
        if (key!=readyKey) { readyKey=key; context.DispatchEvent(root,L"topSceneReady",JSValueObject{{"key",key}}); }
        // Commit the complete scene with the React conversation rail.
        if (presentedSceneKey==key) for (auto const& item:drawings) Draw(item.GetObject());
        for (auto const& entry:pendingDrawings) Draw(entry.second);
      } else readyKey.clear();
    }
    if (stroke) Draw(stroke);
  }
};
FrameworkElement PlayerManager::CreateView() noexcept {
  auto state=std::make_shared<PlayerState>(context); state->Init();
  players.emplace(ViewKey(state->root),state); return state->root;
}
auto PlayerManager::NativeProps() noexcept -> Windows::Foundation::Collections::IMapView<hstring,ViewManagerPropertyType> {
  using T=ViewManagerPropertyType;
  return single_threaded_map<hstring,T>(std::map<hstring,T>{{L"source",T::String},{L"paused",T::Boolean},{L"rate",T::Number},{L"zoom",T::Number},{L"zoomToken",T::Number},{L"seekUs",T::Number},{L"seekToken",T::Number},{L"reviewEndUs",T::Number},{L"sceneJson",T::String},{L"presentedSceneKey",T::String},{L"tool",T::String},{L"flushToken",T::Number},{L"stepToken",T::Number},{L"stepFrames",T::Number}}).GetView();
}
void PlayerManager::UpdateProperties(FrameworkElement const& view,IJSValueReader const& reader) noexcept {
  auto it=players.find(ViewKey(view)); if (it==players.end()) return;
  auto p=it->second;
  try {
    auto props=JSValueObject::ReadFrom(reader);
    p->applyingProps=true;
    if (auto v=props.find("flushToken");v!=props.end() && v->second.AsInt64()>0 && v->second.AsInt64()!=p->flushToken) {
      p->flushToken=v->second.AsInt64(); p->flushRequest=p->flushToken; p->flushDrawing.clear();
      p->paused=true; p->player.Pause();
    }
    if (auto v=props.find("source");v!=props.end()) {
      auto path=to_hstring(v->second.AsString());
      if (p->source!=path) { p->Finish(); p->ResetSeek(); p->seeking=!path.empty(); p->player.Pause(); p->player.Source(nullptr); p->source=path; p->ended=false; ++p->sourceGeneration;
        if (!path.empty()) PlayerState::Load(p,path,p->sourceGeneration);
      }
    }
    if (auto v=props.find("sceneJson");v!=props.end()) {
      auto json=to_hstring(v->second.AsString()); JsonObject parsed{nullptr};
      if (!json.empty()) JsonObject::TryParse(json,parsed);
      bool sameAnchor=false;
      if (parsed && p->scene && parsed.GetNamedString(L"id",L"")==p->scene.GetNamedString(L"id",L"")) {
        auto next=parsed.GetNamedObject(L"anchor",JsonObject{}), previous=p->scene.GetNamedObject(L"anchor",JsonObject{});
        auto kind=next.GetNamedString(L"kind",L"point");
        sameAnchor=kind==previous.GetNamedString(L"kind",L"point") && Number(next,L"at_us")==Number(previous,L"at_us");
      }
      if (!sameAnchor) p->Finish();
      // A flush ACK must clear held ink removed by Undo, including when the
      // authoritative geometry is otherwise identical to the previous scene.
      bool acknowledged=parsed && p->flushToken>0 && Number(parsed,L"flushed")==p->flushToken
        && (!p->scene || Number(parsed,L"flushed")!=Number(p->scene,L"flushed"));
      if (!sameAnchor || acknowledged) p->pendingDrawings.clear();
      if (parsed) for (auto const& item:parsed.GetNamedArray(L"drawings",JsonArray{})) p->pendingDrawings.erase(item.GetObject().GetNamedString(L"id",L""));
      p->scene=parsed;
    }
    if (auto v=props.find("presentedSceneKey");v!=props.end()) {
      auto key=v->second.AsString();
      if (key.empty() && !p->presentedSceneKey.empty()) p->readyKey.clear();
      p->presentedSceneKey=key;
    }
    if (auto v=props.find("tool");v!=props.end()) { auto tool=to_hstring(v->second.AsString()); if (tool!=p->tool) p->Finish(); p->tool=tool; p->overlay.IsHitTestVisible(true); }
    if (auto v=props.find("zoom");v!=props.end()) p->requestedZoom=v->second.AsDouble();
    if (auto v=props.find("zoomToken");v!=props.end() && v->second.AsInt64()!=p->zoomToken) {
      p->zoomToken=v->second.AsInt64(); p->zoomAnchor={}; p->SetZoom(p->requestedZoom); p->zoomTarget=p->zoom;
    }
    if (auto v=props.find("reviewEndUs");v!=props.end()) p->reviewEnd=v->second.AsInt64();
    if (auto v=props.find("stepFrames");v!=props.end()) p->stepFrames=v->second.AsInt64();
    if (auto v=props.find("stepToken");v!=props.end() && v->second.AsInt64()>0 && v->second.AsInt64()!=p->stepToken) {
      p->stepToken=v->second.AsInt64();
      p->Finish(); p->player.Pause();
      p->paused=true;
      if (p->stepFrames<0) {
        if (p->frameRate>0) p->Seek(std::max<int64_t>(0,(p->seeking ? p->pendingSeekTarget : p->Time())-static_cast<int64_t>(std::llround(1000000.0/p->frameRate))));
        else p->Emit(true,"The frame rate is unavailable; use the timeline to seek backward.");
      } else if (!p->seeking) p->player.StepForwardOneFrame();
    }
    if (auto v=props.find("rate");v!=props.end()) {
      p->rate=std::clamp(v->second.AsDouble(),-4.0,4.0);
      auto session=p->player.PlaybackSession();
      p->reverseSeek=p->rate<0 && !session.IsSupportedPlaybackRateRange(p->rate,p->rate);
      session.PlaybackRate(p->reverseSeek ? 1 : p->rate);
      p->reverseTick=std::chrono::steady_clock::now();
      if (p->reverseSeek) p->player.Pause();
      else if (!p->paused && !p->seeking) p->player.Play();
    }
    if (auto v=props.find("seekUs");v!=props.end()) p->seekUs=std::max<int64_t>(0,v->second.AsInt64());
    if (auto v=props.find("seekToken");v!=props.end() && v->second.AsInt64()!=p->seekToken) {
      p->Finish(); p->seekToken=v->second.AsInt64();
      p->ended=false; p->Seek(p->seekUs);
    }
    if (auto v=props.find("paused");v!=props.end()) { p->paused=v->second.AsBoolean(); if (p->paused || p->flushRequest) p->player.Pause(); else { p->ended=false; if (!p->seeking && !p->reverseSeek) p->player.Play(); } }
    p->applyingProps=false; p->StrokeFlush(); p->Render(); p->Emit(true);
  } catch (hresult_error const& error) { p->applyingProps=false; p->Emit(true,to_string(error.message())); }
  catch (std::exception const& error) { p->applyingProps=false; p->Emit(true,error.what()); }
}
ConstantProviderDelegate PlayerManager::ExportedCustomDirectEventTypeConstants() noexcept {
  return [](IJSValueWriter const& writer) noexcept {
    WriteValue(writer,JSValueObject{{"topSceneReady",JSValueObject{{"registrationName","onSceneReady"}}},{"topActivity",JSValueObject{{"registrationName","onActivity"}}},{"topDrawingStart",JSValueObject{{"registrationName","onDrawingStart"}}},{"topPointer",JSValueObject{{"registrationName","onPointer"}}},{"topZoom",JSValueObject{{"registrationName","onZoom"}}},{"topTime",JSValueObject{{"registrationName","onTime"}}},{"topDrawing",JSValueObject{{"registrationName","onDrawing"}}},{"topStrokeFlushFinished",JSValueObject{{"registrationName","onStrokeFlushFinished"}}}});
  };
}
void PlayerManager::OnDropViewInstance(FrameworkElement const& view) noexcept {
  auto it=players.find(ViewKey(view)); if (it!=players.end()) { it->second->Dispose(); players.erase(it); }
}
}
