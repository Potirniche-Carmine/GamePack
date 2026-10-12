#import <React/RCTViewManager.h>
#import <React/RCTView.h>
#import <React/RCTComponent.h>
#import <AVFoundation/AVFoundation.h>
#import <AppKit/AppKit.h>
#import <QuartzCore/QuartzCore.h>

@interface GPPlayer : NSView
@property(nonatomic,copy) NSString *source;
@property(nonatomic) BOOL paused;
@property(nonatomic) float rate;
@property(nonatomic) double zoom;
@property(nonatomic) NSInteger zoomToken;
@property(nonatomic) double seekUs;
@property(nonatomic) NSInteger seekToken;
@property(nonatomic) NSInteger flushToken;
@property(nonatomic) NSInteger stepToken;
@property(nonatomic) NSInteger stepFrames;
@property(nonatomic) double reviewEndUs;
@property(nonatomic,copy) NSString *sceneJson;
@property(nonatomic,copy) NSString *tool;
@property(nonatomic,copy) RCTDirectEventBlock onTime;
@property(nonatomic,copy) RCTDirectEventBlock onDrawing;
@property(nonatomic,copy) RCTDirectEventBlock onDrawingStart;
@property(nonatomic,copy) RCTDirectEventBlock onPointer;
@property(nonatomic,copy) RCTDirectEventBlock onZoom;
@property(nonatomic,copy) RCTDirectEventBlock onSceneReady;
@property(nonatomic,copy) RCTDirectEventBlock onActivity;
- (void)pointerActivity;
@property(nonatomic,copy) RCTDirectEventBlock onStrokeFlushFinished;
- (void)zoomByFactor:(double)factor smooth:(BOOL)smooth;
- (void)animateZoom:(CADisplayLink *)link;
@end

@interface GPZoomTarget : NSObject
@property(nonatomic,weak) GPPlayer *owner;
- (void)tick:(CADisplayLink *)link;
@end
@implementation GPZoomTarget
- (void)tick:(CADisplayLink *)link { [self.owner animateZoom:link]; }
@end

@interface GPGlass : RCTView
@property(nonatomic) BOOL dark;
@property(nonatomic) BOOL desktop;
@property(nonatomic) double cornerRadius;
@end
@implementation GPGlass { NSView *_materialView; }
- (instancetype)initWithFrame:(NSRect)frame {
  if ((self = [super initWithFrame:frame])) {
    if (@available(macOS 26.0, *)) {
      NSGlassEffectView *glass = [[NSGlassEffectView alloc] initWithFrame:self.bounds];
      glass.style = NSGlassEffectViewStyleRegular;
      _materialView = glass;
    } else {
      NSVisualEffectView *frost = [[NSVisualEffectView alloc] initWithFrame:self.bounds];
      frost.blendingMode = NSVisualEffectBlendingModeWithinWindow;
      frost.state = NSVisualEffectStateActive;
      frost.material = NSVisualEffectMaterialHUDWindow;
      _materialView = frost;
    }
    _materialView.wantsLayer = YES;
    _materialView.layer.masksToBounds = YES;
    _materialView.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
    [self addSubview:_materialView];
    // Initialize the default appearance before React applies a dark override.
    [self setDark:NO];
  }
  return self;
}
- (void)setDesktop:(BOOL)desktop {
  if (_desktop == desktop) return;
  _desktop = desktop;
  if (!desktop) return;
  [_materialView removeFromSuperview];
  NSVisualEffectView *frost = [[NSVisualEffectView alloc] initWithFrame:self.bounds];
  frost.blendingMode = NSVisualEffectBlendingModeBehindWindow;
  frost.state = NSVisualEffectStateFollowsWindowActiveState;
  frost.material = NSVisualEffectMaterialUnderWindowBackground;
  frost.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
  _materialView = frost; [self addSubview:frost];
  [self setDark:_dark];
}
- (void)setCornerRadius:(double)cornerRadius {
  _cornerRadius = cornerRadius;
  if (@available(macOS 26.0, *)) { if ([_materialView isKindOfClass:NSGlassEffectView.class]) ((NSGlassEffectView *)_materialView).cornerRadius = cornerRadius; }
  else _materialView.layer.cornerRadius = cornerRadius;
}
- (void)setDark:(BOOL)dark {
  _dark = dark;
  _materialView.appearance = [NSAppearance appearanceNamed:dark ? NSAppearanceNameDarkAqua : NSAppearanceNameAqua];
  if (@available(macOS 26.0, *)) {
    // Glass can adapt to the black video backdrop after a fullscreen transition.
    // Preserve enough light behind the app's dark foreground controls.
    if ([_materialView isKindOfClass:NSGlassEffectView.class]) ((NSGlassEffectView *)_materialView).tintColor = dark ? nil : [NSColor colorWithWhite:1 alpha:.75];
  }
}
@end
@interface GamePackGlassManager : RCTViewManager @end
@implementation GamePackGlassManager
RCT_EXPORT_MODULE(GamePackGlass)
- (NSView *)view { return [GPGlass new]; }
RCT_EXPORT_VIEW_PROPERTY(dark, BOOL)
RCT_EXPORT_VIEW_PROPERTY(desktop, BOOL)
RCT_EXPORT_VIEW_PROPERTY(cornerRadius, double)
@end
@interface GPOverlay : NSView
@property(nonatomic,weak) GPPlayer *owner;
@end
@implementation GPPlayer {
  AVPlayer *_player;
  AVPlayerLayer *_videoLayer;
  GPOverlay *_overlay;
  id _timeObserver;
  NSDictionary *_scene;
  NSMutableArray *_samples;
  NSString *_drawingTool;
  NSTimeInterval _lastEvent;
  BOOL _seeking;
  BOOL _settlingReviewStop;
  BOOL _finished;
  NSInteger _loadGeneration;
  NSInteger _seekGeneration;
  double _duration;
  CGSize _videoSize;
  NSInteger _pendingStrokeFlushToken;
  NSInteger _pendingStepFrames;
  NSDictionary *_pendingStrokeFlushDrawing;
  NSMutableDictionary<NSString *, NSDictionary *> *_pendingDrawings;
  NSString *_readyKey;
  NSTimeInterval _lastActivity;
  id _activityMonitor;
  double _requestedZoom;
  double _zoomTarget;
  CADisplayLink *_zoomDisplayLink;
}
- (BOOL)isFlipped { return YES; }
- (instancetype)initWithFrame:(NSRect)frame {
  if ((self = [super initWithFrame:frame])) {
    self.wantsLayer = YES; self.layer.backgroundColor = NSColor.blackColor.CGColor; self.layer.masksToBounds = YES;
    _paused = YES; _rate = 1; _zoom = _requestedZoom = _zoomTarget = 1; _reviewEndUs = -1; _tool = @"pointer";
    _pendingDrawings = [NSMutableDictionary new];
    _player = [AVPlayer new]; _player.actionAtItemEnd = AVPlayerActionAtItemEndPause;
    _videoLayer = [AVPlayerLayer playerLayerWithPlayer:_player]; _videoLayer.videoGravity = AVLayerVideoGravityResizeAspect;
    [self.layer addSublayer:_videoLayer];
    _overlay = [[GPOverlay alloc] initWithFrame:self.bounds]; _overlay.owner = self;
    // Give ink its own backing layer so AVPlayer's seek redraw cannot cover it.
    _overlay.wantsLayer = YES; _overlay.layer.zPosition = 1;
    _overlay.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable; [self addSubview:_overlay];
    __weak GPPlayer *weakSelf = self;
    _activityMonitor = [NSEvent addLocalMonitorForEventsMatchingMask:NSEventMaskMouseMoved | NSEventMaskLeftMouseDragged | NSEventMaskLeftMouseDown | NSEventMaskRightMouseDown handler:^NSEvent *(NSEvent *event) {
      GPPlayer *self = weakSelf;
      if (self && event.window == self.window) [self pointerActivity];
      return event;
    }];
    _timeObserver = [_player addPeriodicTimeObserverForInterval:CMTimeMake(1, 60) queue:dispatch_get_main_queue() usingBlock:^(CMTime time) { [weakSelf tick]; }];
    [[NSNotificationCenter defaultCenter] addObserver:self selector:@selector(ended:) name:AVPlayerItemDidPlayToEndTimeNotification object:nil];
  } return self;
}
- (void)dealloc { [_zoomDisplayLink invalidate]; if (_activityMonitor) [NSEvent removeMonitor:_activityMonitor]; if (_timeObserver) [_player removeTimeObserver:_timeObserver]; [[NSNotificationCenter defaultCenter] removeObserver:self]; }
- (void)viewDidMoveToWindow { [super viewDidMoveToWindow]; if (!self.window) { [_zoomDisplayLink invalidate]; _zoomDisplayLink = nil; _zoomTarget = _zoom; } }
- (void)layout {
  [super layout];
  [CATransaction begin]; [CATransaction setDisableActions:YES];
  CGSize size = _videoSize;
  CGFloat fit = size.width > 0 && size.height > 0 ? fmin(self.bounds.size.width / size.width, self.bounds.size.height / size.height) : 1;
  _videoLayer.bounds = CGRectMake(0, 0, size.width > 0 ? size.width * fit : self.bounds.size.width, size.height > 0 ? size.height * fit : self.bounds.size.height);
  _videoLayer.position = CGPointMake(NSMidX(self.bounds), NSMidY(self.bounds));
  _videoLayer.affineTransform = CGAffineTransformMakeScale(_zoom, _zoom);
  _overlay.frame = self.bounds;
  [CATransaction commit]; [_overlay setNeedsDisplay:YES];
}
- (void)setSource:(NSString *)source {
  if ([_source isEqualToString:source]) return; _source = [source copy]; _seekGeneration++; _loadGeneration++; NSInteger generation = _loadGeneration;
  [_player pause]; _samples = nil; _duration = 0; _videoSize = CGSizeZero; _finished = NO;
  if (!source.length) { [_player replaceCurrentItemWithPlayerItem:nil]; [_overlay setNeedsDisplay:YES]; return; }
  NSURL *url = [source hasPrefix:@"file:"] ? [NSURL URLWithString:source] : [NSURL fileURLWithPath:source];
  AVURLAsset *asset = [AVURLAsset URLAssetWithURL:url options:nil];
  [_player replaceCurrentItemWithPlayerItem:[AVPlayerItem playerItemWithAsset:asset]];
  __weak GPPlayer *weakSelf = self;
  [asset loadValuesAsynchronouslyForKeys:@[@"duration", @"tracks", @"playable"] completionHandler:^{
    dispatch_async(dispatch_get_main_queue(), ^{
      GPPlayer *self = weakSelf; if (!self || generation != self->_loadGeneration) return;
      NSError *error = nil;
      if ([asset statusOfValueForKey:@"playable" error:&error] == AVKeyValueStatusFailed || !asset.playable) { if (self.onTime) self.onTime(@{@"error":error.localizedDescription ?: @"This video cannot be played by macOS."}); return; }
      self->_duration = CMTimeGetSeconds(asset.duration);
      AVAssetTrack *track = [[asset tracksWithMediaType:AVMediaTypeVideo] firstObject];
      CGSize size = CGSizeApplyAffineTransform(track.naturalSize, track.preferredTransform); self->_videoSize = CGSizeMake(fabs(size.width), fabs(size.height));
      self.needsLayout = YES;
      [self performSeek]; [self emitTime:NO];
    });
  }];
}
- (void)setPaused:(BOOL)paused { _paused = paused; if (!paused) _finished = NO; [_overlay setNeedsDisplay:YES]; }
- (void)setRate:(float)rate { _rate = (rate < 0 ? fmax(-4, rate) : fmax(0.25, fmin(4.0, rate))); }
- (void)setZoom:(double)zoom { _requestedZoom = isfinite(zoom) ? fmin(4, fmax(1, zoom)) : 1; }
- (void)applyZoom:(double)value notify:(BOOL)notify {
  if (fabs(value - _zoom) < 0.00001) return;
  [self finishStroke]; _zoom = value;
  [CATransaction begin]; [CATransaction setDisableActions:YES];
  _videoLayer.affineTransform = CGAffineTransformMakeScale(_zoom, _zoom);
  [CATransaction commit]; [_overlay setNeedsDisplay:YES];
  if (notify && self.onZoom) self.onZoom(@{@"zoom":@(_zoom), @"zoomToken":@(_zoomToken)});
}
- (void)animateZoom:(CADisplayLink *)link {
  double dt = fmin(0.05, fmax(0, link.targetTimestamp - link.timestamp));
  double next = _zoom + (_zoomTarget - _zoom) * (1 - exp(-dt / 0.035));
  if (fabs(next - _zoomTarget) < 0.0005) { next = _zoomTarget; [_zoomDisplayLink invalidate]; _zoomDisplayLink = nil; }
  [self applyZoom:next notify:YES];
}
- (void)zoomByFactor:(double)factor smooth:(BOOL)smooth {
  if (!isfinite(factor) || factor <= 0 || !_player.currentItem) return;
  [self pointerActivity];
  // Continuous input follows the fingers directly. Only discrete wheel steps
  // accumulate into a short, interruptible native display-link transition.
  _zoomTarget = fmin(4, fmax(1, (smooth ? _zoomTarget : _zoom) * factor));
  if (!smooth || NSWorkspace.sharedWorkspace.accessibilityDisplayShouldReduceMotion || !self.window) {
    [_zoomDisplayLink invalidate]; _zoomDisplayLink = nil;
    [self applyZoom:_zoomTarget notify:YES];
  } else if (!_zoomDisplayLink && fabs(_zoomTarget - _zoom) > 0.00001) {
    GPZoomTarget *target = [GPZoomTarget new]; target.owner = self;
    _zoomDisplayLink = [self displayLinkWithTarget:target selector:@selector(tick:)];
    [_zoomDisplayLink addToRunLoop:NSRunLoop.mainRunLoop forMode:NSRunLoopCommonModes];
  }
}
- (void)updateReviewBoundary {
  AVPlayerItem *item = _player.currentItem;
  CMTime end = _reviewEndUs >= 0 ? CMTimeMake(llround(_reviewEndUs), 1000000) : kCMTimeInvalid;
  // Stop on the media clock itself; a periodic UI callback arrives too late.
  item.forwardPlaybackEndTime = _rate > 0 ? end : kCMTimeInvalid;
  item.reversePlaybackEndTime = _rate < 0 ? end : kCMTimeInvalid;
}
- (void)setSeekUs:(double)seekUs { _seekUs = seekUs; }
- (void)setSeekToken:(NSInteger)seekToken { _seekToken = seekToken; }
- (void)didSetProps:(NSArray<NSString *> *)changedProps {
  if ([changedProps containsObject:@"zoomToken"]) {
    [_zoomDisplayLink invalidate]; _zoomDisplayLink = nil;
    _zoomTarget = _requestedZoom; [self applyZoom:_zoomTarget notify:NO];
  }
  if ([changedProps containsObject:@"reviewEndUs"] || [changedProps containsObject:@"rate"] || [changedProps containsObject:@"source"]) [self updateReviewBoundary];
  if ([changedProps containsObject:@"flushToken"] && _flushToken > 0) [self finishStrokeFlush];
  if ([changedProps containsObject:@"sceneJson"]) {
    NSDictionary *next = _sceneJson.length ? [NSJSONSerialization JSONObjectWithData:[_sceneJson dataUsingEncoding:NSUTF8StringEncoding] options:0 error:nil] : nil;
    NSDictionary *anchor = _scene[@"anchor"], *nextAnchor = next[@"anchor"];
    BOOL sameScene = _scene && next && [(_scene[@"id"] ?: @"") isEqual:(next[@"id"] ?: @"")] && [anchor[@"kind"] isEqual:nextAnchor[@"kind"]] && [anchor[@"at_us"] isEqual:nextAnchor[@"at_us"]];
    if (!sameScene) [self finishStroke];
    if (!sameScene) [_pendingDrawings removeAllObjects];
    for (NSDictionary *drawing in next[@"drawings"]) [_pendingDrawings removeObjectForKey:drawing[@"id"]];
    _scene = next; [_overlay setNeedsDisplay:YES];
  }
  if ([changedProps containsObject:@"tool"]) [self finishStroke];
  if ([changedProps containsObject:@"seekToken"] || [changedProps containsObject:@"seekUs"]) [self performSeek];
  if ([changedProps containsObject:@"stepToken"] && _stepToken > 0) {
    _pendingStepFrames += _stepFrames; [self applyFrameSteps];
  }
  [self emitStrokeFlushIfReady];
  if ([changedProps containsObject:@"paused"] || [changedProps containsObject:@"rate"]) {
    if (_paused || _pendingStrokeFlushToken) [_player pause];
    else if (!_seeking) _player.rate = _rate;
  }
  // Publish only after the whole prop batch, including its seek token, is applied.
  if ([changedProps containsObject:@"paused"]) [self emitTime:NO];
}
- (void)applyFrameSteps {
  if (_seeking || !_pendingStepFrames || !_player.currentItem) return;
  [self finishStroke]; [_player pause]; _paused = YES;
  [_player.currentItem stepByCount:(int)_pendingStepFrames]; _pendingStepFrames = 0;
}
- (void)performSeek {
  if (!_seeking && _paused && _duration > 0 && [self timeUs] == llround(_seekUs)) {
    _finished = NO; _settlingReviewStop = NO;
    [_overlay setNeedsDisplay:YES]; [self emitTime:NO]; return;
  }
  [self seekToUs:_seekUs reviewStop:NO];
}
- (void)seekToUs:(double)target reviewStop:(BOOL)reviewStop {
  [self finishStroke]; if (!_player.currentItem) return;
  _seeking = YES; _settlingReviewStop = reviewStop; _finished = reviewStop; NSInteger generation = ++_seekGeneration; [_player pause];
  __weak GPPlayer *weakSelf = self;
  [_player seekToTime:CMTimeMake((int64_t)fmax(0, target), 1000000) toleranceBefore:kCMTimeZero toleranceAfter:kCMTimeZero completionHandler:^(BOOL complete) {
    dispatch_async(dispatch_get_main_queue(), ^{ GPPlayer *self = weakSelf; if (!self || generation != self->_seekGeneration) return; self->_seeking = NO; self->_settlingReviewStop = NO; if (!self.paused && complete && !self->_pendingStrokeFlushToken) self->_player.rate = self.rate; [self applyFrameSteps]; [self emitStrokeFlushIfReady]; [self->_overlay setNeedsDisplay:YES]; [self emitTime:reviewStop && complete]; });
  }];
}
- (void)setSceneJson:(NSString *)sceneJson { _sceneJson = [sceneJson copy]; }
- (void)setTool:(NSString *)tool { _tool = [tool copy]; }
- (int64_t)timeUs { double seconds = CMTimeGetSeconds(_player.currentTime); return isfinite(seconds) ? llround(seconds * 1000000) : 0; }
- (void)tick {
  if (_seeking) return;
  int64_t us = [self timeUs];
  if (!_paused && !_finished && _reviewEndUs >= 0 && (_rate < 0 ? us <= _reviewEndUs : us >= _reviewEndUs)) {
    _paused = YES; [self seekToUs:_reviewEndUs reviewStop:YES]; [_overlay setNeedsDisplay:YES]; return;
  }
  [_overlay setNeedsDisplay:YES];
  if (NSDate.timeIntervalSinceReferenceDate - _lastEvent > 0.1) [self emitTime:NO];
}
- (void)ended:(NSNotification *)notification {
  if (_seeking || _finished || notification.object != _player.currentItem) return;
  [self finishStroke]; _paused = YES; _finished = YES;
  if (_reviewEndUs >= 0) [self seekToUs:_reviewEndUs reviewStop:YES];
  else [self emitTime:YES];
}
- (void)emitTime:(BOOL)ended {
  if (_seeking) return;
  _lastEvent = NSDate.timeIntervalSinceReferenceDate;
  if (self.onTime) self.onTime(@{@"time_us":@([self timeUs]), @"duration_us":@(isfinite(_duration) ? llround(_duration*1000000):0), @"width":@(_videoSize.width), @"height":@(_videoSize.height), @"seekToken":@(_seekToken), @"playing":@(_player.rate != 0), @"ended":@(ended)});
}
- (NSRect)contentRect {
  CGSize size = _videoSize; if (size.width <= 0 || size.height <= 0) return self.bounds;
  CGFloat scale = fmin(self.bounds.size.width/size.width, self.bounds.size.height/size.height) * _zoom;
  CGSize fitted = CGSizeMake(size.width*scale,size.height*scale);
  return NSMakeRect((self.bounds.size.width-fitted.width)/2,(self.bounds.size.height-fitted.height)/2,fitted.width,fitted.height);
}
- (NSDictionary *)sample:(NSEvent *)event {
  NSRect rect = [self contentRect]; NSPoint p = [self convertPoint:event.locationInWindow fromView:nil];
  double x = fmin(1,fmax(0,(p.x-rect.origin.x)/fmax(1,rect.size.width))), y = fmin(1,fmax(0,(p.y-rect.origin.y)/fmax(1,rect.size.height)));
  return @{@"x":@(llround(x*1000000)),@"y":@(llround(y*1000000))};
}
- (void)beginStroke:(NSEvent *)event {
  if ([_tool isEqual:@"pointer"] || [_tool isEqual:@"laser"]) {
    NSPoint p = [self convertPoint:event.locationInWindow fromView:nil];
    if (self.onPointer) self.onPointer(@{@"x":@(p.x / MAX(1, self.bounds.size.width)), @"y":@(p.y / MAX(1, self.bounds.size.height))});
    return;
  }
  if ([_tool isEqual:@"none"] || !_tool.length || !_scene || _seeking) return;
  NSPoint p = [self convertPoint:event.locationInWindow fromView:nil]; if (!NSPointInRect(p,[self contentRect])) return;
  if (!_paused || llabs([self timeUs]-[_scene[@"anchor"][@"at_us"] longLongValue]) > 2000) return;
  [_player pause]; _paused = YES;
  _samples = [NSMutableArray new]; _drawingTool = [_tool copy];
  [_samples addObject:[self sample:event]]; [_overlay setNeedsDisplay:YES];
  if (self.onDrawingStart) self.onDrawingStart(@{@"time_us":@([self timeUs]), @"paused":@(_paused)});
}
- (void)continueStroke:(NSEvent *)event { if (_samples) { if (_samples.count < 50000) [_samples addObject:[self sample:event]]; [_overlay setNeedsDisplay:YES]; } }
- (NSDictionary *)currentDrawing {
  NSArray *points = _samples;
  if (![_drawingTool isEqual:@"pen"] && points.count > 1) points = @[points.firstObject,points.lastObject];
  return @{@"id":NSUUID.UUID.UUIDString.lowercaseString,@"tool":_drawingTool ?: @"pen",@"width":@3500,@"samples":points ?: @[]};
}
- (NSDictionary *)takeStroke {
  if (!_samples) return nil;
  if (_samples.count == 1) [_samples addObject:_samples.firstObject];
  NSDictionary *drawing = [self currentDrawing]; _samples = nil;
  _pendingDrawings[drawing[@"id"]] = drawing;
  [_overlay setNeedsDisplay:YES];
  return drawing;
}
- (void)finishStroke {
  NSDictionary *drawing = [self takeStroke];
  if (!drawing) return;
  if (self.onDrawing) { NSData *json = [NSJSONSerialization dataWithJSONObject:drawing options:0 error:nil]; self.onDrawing(@{@"drawingJson":[[NSString alloc] initWithData:json encoding:NSUTF8StringEncoding]}); }
}
- (void)finishStrokeFlush {
  [_player pause]; _paused = YES;
  _pendingStrokeFlushToken = _flushToken;
  _pendingStrokeFlushDrawing = [self takeStroke];
}
- (void)emitStrokeFlushIfReady {
  if (!_pendingStrokeFlushToken || _seeking) return;
  [_player pause]; _paused = YES;
  int64_t time = [self timeUs];
  NSDictionary *drawing = _pendingStrokeFlushDrawing;
  NSMutableDictionary *event = [@{@"flushToken":@(_pendingStrokeFlushToken), @"time_us":@(time)} mutableCopy];
  _pendingStrokeFlushToken = 0; _pendingStrokeFlushDrawing = nil;
  if (drawing) {
    NSData *json = [NSJSONSerialization dataWithJSONObject:drawing options:0 error:nil];
    event[@"drawingJson"] = [[NSString alloc] initWithData:json encoding:NSUTF8StringEncoding];
  }
  if (self.onStrokeFlushFinished) self.onStrokeFlushFinished(event);
  [self emitTime:NO];
}
- (NSPoint)point:(NSDictionary *)sample rect:(NSRect)rect { return NSMakePoint(rect.origin.x+[sample[@"x"] doubleValue]/1000000*rect.size.width,rect.origin.y+[sample[@"y"] doubleValue]/1000000*rect.size.height); }
- (void)drawDrawing:(NSDictionary *)drawing rect:(NSRect)rect {
  NSArray *visible=drawing[@"samples"]; if (!visible.count) return;
  NSString *tool=drawing[@"tool"];
  CGFloat width=fmax(1.5,[drawing[@"width"] doubleValue]/1000000*rect.size.width);
  NSBezierPath *path=[NSBezierPath bezierPath]; path.lineWidth=width; path.lineCapStyle=NSLineCapStyleRound; path.lineJoinStyle=NSLineJoinStyleRound;
  NSPoint first=[self point:visible.firstObject rect:rect],last=[self point:visible.lastObject rect:rect];
  if ([tool isEqual:@"ellipse"]) [path appendBezierPathWithOvalInRect:NSMakeRect(fmin(first.x,last.x),fmin(first.y,last.y),fmax(1,fabs(last.x-first.x)),fmax(1,fabs(last.y-first.y)))];
  else { [path moveToPoint:first]; for (NSDictionary *sample in visible) [path lineToPoint:[self point:sample rect:rect]];
    if ([tool isEqual:@"arrow"]) { CGFloat angle=atan2(last.y-first.y,last.x-first.x),head=MAX(12,width*4); [path moveToPoint:NSMakePoint(last.x-head*cos(angle-0.48),last.y-head*sin(angle-0.48))]; [path lineToPoint:last]; [path lineToPoint:NSMakePoint(last.x-head*cos(angle+0.48),last.y-head*sin(angle+0.48))]; }
  }
  CGFloat opacity=drawing[@"opacity"] ? [drawing[@"opacity"] doubleValue] : 1;
  [[NSColor colorWithWhite:0 alpha:0.5*opacity] setStroke]; path.lineWidth=width+2; [path stroke]; [[NSColor colorWithRed:121.0/255 green:191.0/255 blue:253.0/255 alpha:opacity] setStroke]; path.lineWidth=width; [path stroke];
}
- (void)pointerActivity {
  NSTimeInterval now = NSDate.timeIntervalSinceReferenceDate;
  if (self.onActivity && now - _lastActivity > 0.12) { _lastActivity = now; self.onActivity(@{}); }
}
- (void)drawOverlay {
  NSRect rect=[self contentRect]; [NSGraphicsContext saveGraphicsState]; NSRectClip(rect);
  int64_t anchor = [_scene[@"anchor"][@"at_us"] longLongValue], time = [self timeUs];
  double distance = _rate < 0 ? time - anchor : anchor - time;
  BOOL atReviewStop = _reviewEndUs >= 0 && llabs(anchor - (int64_t)_reviewEndUs) <= 2000;
  BOOL preview = !_paused && atReviewStop && distance >= 0 && distance <= [_scene[@"preview_lead_us"] doubleValue] * fabs(_rate);
  BOOL visible = (_settlingReviewStop && atReviewStop) || (!_seeking && (preview || (_paused && llabs(time-anchor) <= 2000)));
  if (visible && _scene) {
    for (NSDictionary *drawing in _scene[@"drawings"]) [self drawDrawing:drawing rect:rect];
    for (NSDictionary *drawing in _pendingDrawings.allValues) [self drawDrawing:drawing rect:rect];
    NSString *key = [NSString stringWithFormat:@"%@:%lu:%ld", _scene[@"id"], (unsigned long)[_scene[@"drawings"] count], (long)_seekToken];
    if (![_readyKey isEqual:key]) {
      _readyKey = key;
      dispatch_async(dispatch_get_main_queue(), ^{ if (self.onSceneReady) self.onSceneReady(@{@"key":key}); });
    }
  } else _readyKey = nil;
  if (_samples) [self drawDrawing:[self currentDrawing] rect:rect];
  [NSGraphicsContext restoreGraphicsState];
}
@end
@implementation GPOverlay {
  BOOL _pointerDown;
  NSTrackingArea *_tracking;
}
- (BOOL)isFlipped { return YES; }
- (BOOL)isOpaque { return NO; }
- (void)updateTrackingAreas {
  [super updateTrackingAreas];
  if (_tracking) [self removeTrackingArea:_tracking];
  _tracking = [[NSTrackingArea alloc] initWithRect:NSZeroRect options:NSTrackingMouseMoved | NSTrackingActiveInActiveApp | NSTrackingInVisibleRect owner:self userInfo:nil];
  [self addTrackingArea:_tracking];
}
- (void)mouseMoved:(NSEvent *)event { [self.owner pointerActivity]; }
- (void)viewDidChangeEffectiveAppearance {
  [super viewDidChangeEffectiveAppearance];
  // AppKit invalidates the transparent backing layer when appearance changes.
  // A paused AVPlayer has no next frame to request the annotation redraw.
  [self setNeedsDisplay:YES];
}
- (void)drawRect:(NSRect)dirtyRect { [self.owner drawOverlay]; }
- (BOOL)acceptsFirstResponder { return YES; }
- (BOOL)eventTargetsOverlay:(NSEvent *)event {
  // AppKit may forward an unhandled React control event to the current first
  // responder. Floating controls must never trigger a pointer or stroke below.
  NSView *content = self.window.contentView;
  NSPoint point = [content.superview convertPoint:event.locationInWindow fromView:nil];
  NSView *hit = [content hitTest:point];
  return hit == self || [hit isDescendantOf:self];
}
- (void)mouseDown:(NSEvent *)event {
  _pointerDown = [self eventTargetsOverlay:event];
  if (!_pointerDown) return;
  [self.window makeFirstResponder:self]; [self.owner beginStroke:event];
}
- (void)mouseDragged:(NSEvent *)event { if (_pointerDown) [self.owner continueStroke:event]; }
- (void)mouseUp:(NSEvent *)event {
  if (!_pointerDown) return;
  _pointerDown = NO;
  [self.owner continueStroke:event]; [self.owner finishStroke];
}
- (void)magnifyWithEvent:(NSEvent *)event {
  if ([self eventTargetsOverlay:event]) [self.owner zoomByFactor:fmax(0.05, 1 + event.magnification) smooth:NO];
}
- (void)smartMagnifyWithEvent:(NSEvent *)event {
  if ([self eventTargetsOverlay:event]) [self.owner zoomByFactor:(self.owner.zoom > 1 ? 1 / self.owner.zoom : 2) smooth:NO];
}
- (void)scrollWheel:(NSEvent *)event {
  if (![self eventTargetsOverlay:event] || fabs(event.scrollingDeltaY) < 0.001) return;
  double delta = event.scrollingDeltaY * (event.hasPreciseScrollingDeltas ? 0.0025 : 0.08);
  [self.owner zoomByFactor:exp(fmin(0.18, fmax(-0.18, delta))) smooth:!event.hasPreciseScrollingDeltas];
}
@end
@interface GamePackPlayerManager : RCTViewManager @end
@implementation GamePackPlayerManager
RCT_EXPORT_MODULE(GamePackPlayer)
- (NSView *)view { return [GPPlayer new]; }
RCT_EXPORT_VIEW_PROPERTY(source, NSString)
RCT_EXPORT_VIEW_PROPERTY(paused, BOOL)
RCT_EXPORT_VIEW_PROPERTY(rate, float)
RCT_EXPORT_VIEW_PROPERTY(zoom, double)
RCT_EXPORT_VIEW_PROPERTY(zoomToken, NSInteger)
RCT_EXPORT_VIEW_PROPERTY(seekUs, double)
RCT_EXPORT_VIEW_PROPERTY(seekToken, NSInteger)
RCT_EXPORT_VIEW_PROPERTY(flushToken, NSInteger)
RCT_EXPORT_VIEW_PROPERTY(stepToken, NSInteger)
RCT_EXPORT_VIEW_PROPERTY(stepFrames, NSInteger)
RCT_EXPORT_VIEW_PROPERTY(reviewEndUs, double)
RCT_EXPORT_VIEW_PROPERTY(sceneJson, NSString)
RCT_EXPORT_VIEW_PROPERTY(tool, NSString)
RCT_EXPORT_VIEW_PROPERTY(onTime, RCTDirectEventBlock)
RCT_EXPORT_VIEW_PROPERTY(onDrawing, RCTDirectEventBlock)
RCT_EXPORT_VIEW_PROPERTY(onDrawingStart, RCTDirectEventBlock)
RCT_EXPORT_VIEW_PROPERTY(onPointer, RCTDirectEventBlock)
RCT_EXPORT_VIEW_PROPERTY(onZoom, RCTDirectEventBlock)
RCT_EXPORT_VIEW_PROPERTY(onSceneReady, RCTDirectEventBlock)
RCT_EXPORT_VIEW_PROPERTY(onActivity, RCTDirectEventBlock)
RCT_EXPORT_VIEW_PROPERTY(onStrokeFlushFinished, RCTDirectEventBlock)
@end
