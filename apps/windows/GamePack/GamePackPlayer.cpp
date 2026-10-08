#include "pch.h"
#include "GamePackPlayer.h"
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
static double Number(JsonObject const& object, wchar_t const* key, double fallback = 0) { return object.GetNamedNumber(key, fallback); }
static JsonValue N(double value) { return JsonValue::CreateNumberValue(value); }
static JsonValue S(hstring const& value) { return JsonValue::CreateStringValue(value); }
static constexpr double scale = 1000000.0;
static void* ViewKey(FrameworkElement const& view) { return get_abi(view.as<Windows::Foundation::IInspectable>()); }
struct PlayerState : std::enable_shared_from_this<PlayerState> {
  Grid root;
  MediaPlayerElement element;
  Canvas overlay;
  Windows::Media::Playback::MediaPlayer player;
  DispatcherTimer timer;
  Microsoft::ReactNative::ReactContext context;
  JsonObject scene{nullptr}, live{nullptr};
  JsonArray samples{nullptr};
  hstring tool{L"none"}, color{L"#FF775E"}, source;
  int64_t seekToken{-1}, seekUs{}, reviewEnd{-1}, captureToken{}, captureRequest{};
  std::string captureDrawing;
  bool paused{true}, ended{}, capturing{}, disposed{}, seeking{}, seekInFlight{}, applyingProps{};
  uint64_t sourceGeneration{}, seekGeneration{}, activeSeekGeneration{};
  int64_t pendingSeekTarget{};
  event_token seekCompletedToken{};
  std::chrono::steady_clock::time_point lastEmit{};
  event_token timerToken{}, openedToken{}, endedToken{}, failedToken{};
  explicit PlayerState(IReactContext const& ctx) : context(ctx) {
    root.Background(SolidColorBrush(Colors::Black()));
    root.Children().Append(element);
    root.Children().Append(overlay);
    element.AreTransportControlsEnabled(false);
    element.Stretch(Stretch::Uniform);
    player.AutoPlay(false);
    player.IsVideoFrameServerEnabled(false);
    element.SetMediaPlayer(player);
    overlay.Background(SolidColorBrush(Colors::Transparent()));
    overlay.IsHitTestVisible(false);
  }
  int64_t Time() { return std::max<int64_t>(0, player.PlaybackSession().Position().count() / 10); }
  int64_t Duration() { return std::max<int64_t>(0, player.PlaybackSession().NaturalDuration().count() / 10); }
  Rect ContentRect() {
    double w = root.ActualWidth(), h = root.ActualHeight();
    auto session = player.PlaybackSession();
    double vw = session.NaturalVideoWidth(), vh = session.NaturalVideoHeight();
    if (vw <= 0 || vh <= 0 || w <= 0 || h <= 0) return Rect{0, 0, 0, 0};
    double fit = std::min(w / vw, h / vh);
    return Rect{static_cast<float>((w-vw*fit)/2), static_cast<float>((h-vh*fit)/2), static_cast<float>(vw*fit), static_cast<float>(vh*fit)};
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
    seeking=false;
    if (captureRequest) Capture();
    else if (!paused) player.Play();
    Render(); Emit(true);
  }
  void StartSeek() {
    if (disposed || seekInFlight || Duration()<=0) return;
    auto target=std::clamp<int64_t>(pendingSeekTarget,0,Duration());
    auto generation=seekGeneration;
    if (Time()==target) { seeking=false; if (captureRequest) Capture(); else if (!paused) player.Play(); Render(); Emit(true); return; }
    seekInFlight=true; activeSeekGeneration=generation;
    auto weak=weak_from_this();
    seekCompletedToken=player.PlaybackSession().SeekCompleted([weak,generation](auto const&,auto const&) {
      if (auto self=weak.lock()) self->root.Dispatcher().RunAsync(Windows::UI::Core::CoreDispatcherPriority::Normal,[weak,generation] {
        if (auto p=weak.lock()) p->CompleteSeek(generation);
      });
    });
    player.PlaybackSession().Position(std::chrono::microseconds(target));
  }
  void Seek(int64_t target) {
    Finish(); ++seekGeneration; pendingSeekTarget=target; seeking=true;
    player.Pause(); StartSeek();
  }
  bool CanAnnotate() {
    if (disposed || seeking || !scene || source.empty() || Duration()<=0) return false;
    auto anchor=scene.GetNamedObject(L"anchor",JsonObject{});
    auto t=Time();
    if (anchor.GetNamedString(L"kind",L"point")==L"interval")
      return t>=Number(anchor,L"start_us") && t<Number(anchor,L"end_us");
    return paused && std::abs(t-static_cast<int64_t>(Number(anchor,L"at_us")))<=2000;
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
      {"playing", session.PlaybackState() == Windows::Media::Playback::MediaPlaybackState::Playing},
      {"ended", ended}, {"error", std::move(error)}});
  }
  void Init() {
    auto weak = weak_from_this();
    timer.Interval(std::chrono::milliseconds(16));
    timerToken = timer.Tick([weak](auto const&, auto const&) {
      if (auto self = weak.lock(); self && !self->disposed && !self->seeking) {
        if (self->reviewEnd >= 0 && !self->paused && self->Time() >= self->reviewEnd) {
          self->Finish(); self->player.Pause(); self->paused = true;
          self->ended = true; self->Seek(self->reviewEnd);
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
    root.SizeChanged([weak](auto const&, auto const&) { if (auto self = weak.lock()) self->Render(); });
    overlay.PointerPressed([weak](auto const&, Windows::UI::Xaml::Input::PointerRoutedEventArgs const& args) {
      if (auto self = weak.lock(); self && self->tool != L"none" && self->CanAnnotate()) {
        auto point = args.GetCurrentPoint(self->overlay);
        auto r = self->ContentRect(); auto p = point.Position();
        if (r.Width <= 0 || p.X < r.X || p.Y < r.Y || p.X > r.X+r.Width || p.Y > r.Y+r.Height) return;
        if (!point.Properties().IsLeftButtonPressed() && point.PointerDevice().PointerDeviceType() == Windows::Devices::Input::PointerDeviceType::Mouse) return;
        self->Finish(); self->capturing = true;
        self->overlay.CapturePointer(args.Pointer());
        self->samples = JsonArray{}; self->live = JsonObject{};
        GUID guid{}; CoCreateGuid(&guid); wchar_t id[40]{}; StringFromGUID2(guid, id, 40);
        self->live.SetNamedValue(L"id", S(hstring(id + 1, 36))); self->live.SetNamedValue(L"tool", S(self->tool));
        self->live.SetNamedValue(L"color", S(self->color)); self->live.SetNamedValue(L"width", N(3500));
        self->live.SetNamedValue(L"visible_from_us", N(self->RelativeTime()));
        self->live.SetNamedValue(L"visible_until_us", N(self->IntervalDuration()));
        self->live.SetNamedValue(L"samples", self->samples);
        self->Sample(p); self->Render(); args.Handled(true);
      }
    });
    overlay.PointerMoved([weak](auto const&, Windows::UI::Xaml::Input::PointerRoutedEventArgs const& args) { if (auto self=weak.lock(); self && self->capturing) {
      self->Sample(args.GetCurrentPoint(self->overlay).Position()); self->Render(); args.Handled(true);
    }});
    overlay.PointerReleased([weak](auto const&, Windows::UI::Xaml::Input::PointerRoutedEventArgs const& args) { if (auto self=weak.lock(); self && self->capturing) {
      self->Sample(args.GetCurrentPoint(self->overlay).Position()); self->Finish(); args.Handled(true);
    }});
    overlay.PointerCanceled([weak](auto const&, auto const&) { if (auto self=weak.lock()) self->Finish(); });
    overlay.PointerCaptureLost([weak](auto const&, auto const&) { if (auto self=weak.lock()) self->Finish(); });
    root.Loaded([weak](auto const&, auto const&) { if (auto self=weak.lock()) self->timer.Start(); });
    root.Unloaded([weak](auto const&, auto const&) { if (auto self=weak.lock()) { self->timer.Stop(); self->Finish(); self->player.Pause(); } });
    timer.Start();
  }
  int64_t IntervalDuration() {
    if (!scene) return 0;
    auto anchor=scene.GetNamedObject(L"anchor", JsonObject{});
    return anchor.GetNamedString(L"kind", L"point") == L"interval" ? static_cast<int64_t>(Number(anchor,L"end_us")-Number(anchor,L"start_us")) : 0;
  }
  int64_t RelativeTime() {
    if (!scene || IntervalDuration() == 0) return 0;
    auto anchor=scene.GetNamedObject(L"anchor", JsonObject{});
    return std::clamp<int64_t>(Time()-static_cast<int64_t>(Number(anchor,L"start_us")), 0, std::max<int64_t>(0,IntervalDuration()-1));
  }
  void Sample(Point p) {
    if (!capturing || !samples) return;
    if (!CanAnnotate()) { Finish(); return; }
    auto r=ContentRect(); if (r.Width <= 0 || r.Height <= 0) return;
    if (samples.Size() >= 50000) { Finish(); return; }
    JsonObject sample;
    sample.SetNamedValue(L"x", N(std::round(std::clamp((p.X-r.X)/r.Width, 0.0f, 1.0f)*scale)));
    sample.SetNamedValue(L"y", N(std::round(std::clamp((p.Y-r.Y)/r.Height, 0.0f, 1.0f)*scale)));
    auto timestamp=RelativeTime();
    if (samples.Size()) timestamp=std::max<int64_t>(timestamp,static_cast<int64_t>(Number(samples.GetObjectAt(samples.Size()-1),L"t_us")));
    sample.SetNamedValue(L"t_us", N(static_cast<double>(timestamp)));
    samples.Append(sample);
  }
  std::string Finish(bool notify=true) {
    if (!capturing) return {};
    capturing=false;
    overlay.ReleasePointerCaptures();
    if (live && samples && samples.Size()) {
      if (live.GetNamedString(L"tool", L"pen") != L"pen") {
        JsonArray endpoints;
        endpoints.Append(samples.GetAt(0));
        endpoints.Append(samples.GetAt(samples.Size()-1));
        live.SetNamedValue(L"samples", endpoints);
      }
      auto json=to_string(live.Stringify());
      if (captureRequest) captureDrawing=json;
      else if (notify) context.DispatchEvent(root, L"topDrawing", JSValueObject{{"drawingJson",json}});
      live=nullptr; samples=nullptr; Render();
      return json;
    }
    live=nullptr; samples=nullptr; Render();
    return {};
  }
  void Capture() {
    if (!captureRequest || disposed || seeking || applyingProps) return;
    paused=true; player.Pause();
    // Finish uses the pending request to put this stroke exclusively in the ACK.
    Finish(false);
    auto token=captureRequest;
    captureRequest=0;
    JSValueObject result{{"captureToken",token},{"time_us",Time()}};
    if (!captureDrawing.empty()) result["drawingJson"]=std::move(captureDrawing);
    captureDrawing.clear();
    context.DispatchEvent(root,L"topCaptureFinished",std::move(result));
  }
  void Dispose() {
    if (disposed) return;
    Finish(); ResetSeek(); disposed=true; timer.Stop(); timer.Tick(timerToken);
    player.MediaOpened(openedToken); player.MediaEnded(endedToken); player.MediaFailed(failedToken);
    player.Pause(); player.Close();
  }
  static fire_and_forget Load(std::weak_ptr<PlayerState> weak, hstring path, uint64_t generation) {
    try {
      auto file = co_await Windows::Storage::StorageFile::GetFileFromPathAsync(path);
      if (auto self=weak.lock(); self && !self->disposed && generation==self->sourceGeneration) {
        self->player.Source(Windows::Media::Core::MediaSource::CreateFromStorageFile(file));
      }
    } catch (hresult_error const& error) {
      if (auto self=weak.lock(); self && !self->disposed && generation==self->sourceGeneration) self->Emit(true,to_string(error.message()));
    }
  }
  void Draw(JsonObject const& drawing, int64_t relative, bool liveStroke=false) {
    auto r=ContentRect(); if (r.Width <= 0) return;
    auto list=drawing.GetNamedArray(L"samples",JsonArray{});
    auto type=drawing.GetNamedString(L"tool",L"pen");
    std::vector<Point> points;
    for (auto const& item:list) {
      auto sample=item.GetObject();
      if (!liveStroke && type==L"pen" && Number(sample,L"t_us") > relative) break;
      points.push_back(Point{r.X+static_cast<float>(Number(sample,L"x")/scale*r.Width),r.Y+static_cast<float>(Number(sample,L"y")/scale*r.Height)});
    }
    if (points.empty()) return;
    auto hex=to_string(drawing.GetNamedString(L"color",L"#FF775E"));
    unsigned int rgb=0xff775e;
    if (hex.size()==7 && hex[0]=='#') { try { rgb=std::stoul(hex.substr(1),nullptr,16); } catch (...) {} }
    SolidColorBrush brush(Color{255,static_cast<uint8_t>((rgb>>16)&255),static_cast<uint8_t>((rgb>>8)&255),static_cast<uint8_t>(rgb&255)});
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
    if (seeking) return;
    if (scene) {
      auto anchor=scene.GetNamedObject(L"anchor",JsonObject{});
      bool interval=anchor.GetNamedString(L"kind",L"point")==L"interval";
      int64_t t=Time(), start=static_cast<int64_t>(Number(anchor,interval ? L"start_us":L"at_us"));
      bool visible=interval ? t>=start && t<Number(anchor,L"end_us") : paused && std::abs(t-start)<=2000;
      if (visible) for (auto const& item:scene.GetNamedArray(L"drawings",JsonArray{})) {
        auto d=item.GetObject(); int64_t relative=interval ? t-start:0;
        if (!interval || (relative>=Number(d,L"visible_from_us") && relative<Number(d,L"visible_until_us"))) Draw(d,relative);
      }
    }
    if (live) Draw(live,RelativeTime(),true);
  }
};
FrameworkElement PlayerManager::CreateView() noexcept {
  auto state=std::make_shared<PlayerState>(context); state->Init();
  players.emplace(ViewKey(state->root),state); return state->root;
}
auto PlayerManager::NativeProps() noexcept -> Windows::Foundation::Collections::IMapView<hstring,ViewManagerPropertyType> {
  using T=ViewManagerPropertyType;
  return single_threaded_map<hstring,T>(std::map<hstring,T>{{L"source",T::String},{L"paused",T::Boolean},{L"rate",T::Number},{L"seekUs",T::Number},{L"seekToken",T::Number},{L"reviewEndUs",T::Number},{L"sceneJson",T::String},{L"tool",T::String},{L"strokeColor",T::String},{L"captureToken",T::Number}}).GetView();
}
void PlayerManager::UpdateProperties(FrameworkElement const& view,IJSValueReader const& reader) noexcept {
  auto it=players.find(ViewKey(view)); if (it==players.end()) return;
  auto p=it->second;
  try {
    auto props=JSValueObject::ReadFrom(reader);
    p->applyingProps=true;
    if (auto v=props.find("captureToken");v!=props.end() && v->second.AsInt64()>0 && v->second.AsInt64()!=p->captureToken) {
      p->captureToken=v->second.AsInt64(); p->captureRequest=p->captureToken; p->captureDrawing.clear();
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
        auto key=kind==L"interval" ? L"start_us" : L"at_us";
        sameAnchor=kind==previous.GetNamedString(L"kind",L"point") && Number(next,key)==Number(previous,key);
      }
      if (!sameAnchor) p->Finish();
      p->scene=parsed;
    }
    if (auto v=props.find("tool");v!=props.end()) { auto tool=to_hstring(v->second.AsString()); if (tool!=p->tool) p->Finish(); p->tool=tool; p->overlay.IsHitTestVisible(tool!=L"none"); }
    if (auto v=props.find("strokeColor");v!=props.end()) p->color=to_hstring(v->second.AsString());
    if (auto v=props.find("reviewEndUs");v!=props.end()) p->reviewEnd=v->second.AsInt64();
    if (auto v=props.find("rate");v!=props.end()) p->player.PlaybackSession().PlaybackRate(std::clamp(v->second.AsDouble(),0.25,4.0));
    if (auto v=props.find("seekUs");v!=props.end()) p->seekUs=std::max<int64_t>(0,v->second.AsInt64());
    if (auto v=props.find("seekToken");v!=props.end() && v->second.AsInt64()!=p->seekToken) {
      p->Finish(); p->seekToken=v->second.AsInt64();
      p->ended=false; p->Seek(p->seekUs);
    }
    if (auto v=props.find("paused");v!=props.end()) { p->paused=v->second.AsBoolean(); if (p->paused || p->captureRequest) p->player.Pause(); else { p->ended=false; if (!p->seeking) p->player.Play(); } }
    p->applyingProps=false; p->Capture(); p->Render(); p->Emit(true);
  } catch (hresult_error const& error) { p->applyingProps=false; p->Emit(true,to_string(error.message())); }
  catch (std::exception const& error) { p->applyingProps=false; p->Emit(true,error.what()); }
}
ConstantProviderDelegate PlayerManager::ExportedCustomDirectEventTypeConstants() noexcept {
  return [](IJSValueWriter const& writer) noexcept {
    WriteValue(writer,JSValueObject{{"topTime",JSValueObject{{"registrationName","onTime"}}},{"topDrawing",JSValueObject{{"registrationName","onDrawing"}}},{"topCaptureFinished",JSValueObject{{"registrationName","onCaptureFinished"}}}});
  };
}
void PlayerManager::OnDropViewInstance(FrameworkElement const& view) noexcept {
  auto it=players.find(ViewKey(view)); if (it!=players.end()) { it->second->Dispose(); players.erase(it); }
}
}
