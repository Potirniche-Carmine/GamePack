#import <React/RCTViewManager.h>
#import <React/RCTComponent.h>
#import <AVFoundation/AVFoundation.h>
#import <AppKit/AppKit.h>

@interface GPPlayer : NSView
@property(nonatomic,copy) NSString *source;
@property(nonatomic) BOOL paused;
@property(nonatomic) float rate;
@property(nonatomic) double seekUs;
@property(nonatomic) NSInteger seekToken;
@property(nonatomic) double reviewEndUs;
@property(nonatomic,copy) NSString *sceneJson;
@property(nonatomic,copy) NSString *tool;
@property(nonatomic,copy) NSString *strokeColor;
@property(nonatomic,copy) RCTDirectEventBlock onTime;
@property(nonatomic,copy) RCTDirectEventBlock onDrawing;
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
  NSString *_drawingColor;
  int64_t _drawingStart;
  NSTimeInterval _lastEvent;
  BOOL _seeking;
  BOOL _finished;
  NSInteger _loadGeneration;
  double _duration;
  CGSize _videoSize;
}
- (BOOL)isFlipped { return YES; }
- (instancetype)initWithFrame:(NSRect)frame {
  if ((self = [super initWithFrame:frame])) {
    self.wantsLayer = YES; self.layer.backgroundColor = NSColor.blackColor.CGColor;
    _paused = YES; _rate = 1; _reviewEndUs = -1; _tool = @"none"; _strokeColor = @"#FFCC66";
    _player = [AVPlayer new]; _player.actionAtItemEnd = AVPlayerActionAtItemEndPause;
    _videoLayer = [AVPlayerLayer playerLayerWithPlayer:_player]; _videoLayer.videoGravity = AVLayerVideoGravityResizeAspect;
    [self.layer addSublayer:_videoLayer];
    _overlay = [[GPOverlay alloc] initWithFrame:self.bounds]; _overlay.owner = self; _overlay.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable; [self addSubview:_overlay];
    __weak GPPlayer *weakSelf = self;
    _timeObserver = [_player addPeriodicTimeObserverForInterval:CMTimeMake(1, 60) queue:dispatch_get_main_queue() usingBlock:^(CMTime time) { [weakSelf tick]; }];
    [[NSNotificationCenter defaultCenter] addObserver:self selector:@selector(ended:) name:AVPlayerItemDidPlayToEndTimeNotification object:nil];
  } return self;
}
- (void)dealloc { if (_timeObserver) [_player removeTimeObserver:_timeObserver]; [[NSNotificationCenter defaultCenter] removeObserver:self]; }
- (void)layout { [super layout]; [CATransaction begin]; [CATransaction setDisableActions:YES]; _videoLayer.frame = self.bounds; _overlay.frame = self.bounds; [CATransaction commit]; [_overlay setNeedsDisplay:YES]; }
- (void)setSource:(NSString *)source {
  if ([_source isEqualToString:source]) return; _source = [source copy]; _loadGeneration++; NSInteger generation = _loadGeneration;
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
      [self performSeek]; [self emitTime:NO];
    });
  }];
}
- (void)setPaused:(BOOL)paused { _paused = paused; _finished = NO; if (paused) [_player pause]; else if (!_seeking) _player.rate = _rate; [_overlay setNeedsDisplay:YES]; }
- (void)setRate:(float)rate { _rate = fmax(0.25, fmin(2.0, rate)); if (!_paused && !_seeking) _player.rate = _rate; }
- (void)setSeekUs:(double)seekUs { _seekUs = seekUs; }
- (void)setSeekToken:(NSInteger)seekToken { _seekToken = seekToken; [self performSeek]; }
- (void)performSeek {
  [self finishStroke]; if (!_player.currentItem) return;
  _seeking = YES; _finished = NO;
  __weak GPPlayer *weakSelf = self;
  [_player seekToTime:CMTimeMake((int64_t)fmax(0, _seekUs), 1000000) toleranceBefore:kCMTimeZero toleranceAfter:kCMTimeZero completionHandler:^(BOOL complete) {
    dispatch_async(dispatch_get_main_queue(), ^{ GPPlayer *self = weakSelf; if (!self) return; self->_seeking = NO; if (!self.paused) self->_player.rate = self.rate; [self->_overlay setNeedsDisplay:YES]; [self emitTime:NO]; });
  }];
}
- (void)setSceneJson:(NSString *)sceneJson { _sceneJson = [sceneJson copy]; _scene = sceneJson.length ? [NSJSONSerialization JSONObjectWithData:[sceneJson dataUsingEncoding:NSUTF8StringEncoding] options:0 error:nil] : nil; [_overlay setNeedsDisplay:YES]; }
- (void)setTool:(NSString *)tool { [self finishStroke]; _tool = [tool copy]; }
- (int64_t)timeUs { double seconds = CMTimeGetSeconds(_player.currentTime); return isfinite(seconds) ? llround(seconds * 1000000) : 0; }
- (void)tick {
  int64_t us = [self timeUs];
  if (!_paused && !_finished && _reviewEndUs >= 0 && us >= _reviewEndUs) { [self finishStroke]; [_player pause]; _finished = YES; [self emitTime:YES]; }
  [_overlay setNeedsDisplay:YES];
  if (NSDate.timeIntervalSinceReferenceDate - _lastEvent > 0.1) [self emitTime:NO];
}
- (void)ended:(NSNotification *)notification { if (notification.object == _player.currentItem) { [self finishStroke]; _finished = YES; [self emitTime:YES]; } }
- (void)emitTime:(BOOL)ended {
  _lastEvent = NSDate.timeIntervalSinceReferenceDate;
  if (self.onTime) self.onTime(@{@"time_us":@([self timeUs]), @"duration_us":@(isfinite(_duration) ? llround(_duration*1000000):0), @"width":@(_videoSize.width), @"height":@(_videoSize.height), @"playing":@(_player.rate > 0), @"ended":@(ended)});
}
- (NSRect)contentRect {
  CGSize size = _videoSize; if (size.width <= 0 || size.height <= 0) return self.bounds;
  CGFloat scale = fmin(self.bounds.size.width/size.width, self.bounds.size.height/size.height);
  CGSize fitted = CGSizeMake(size.width*scale,size.height*scale);
  return NSMakeRect((self.bounds.size.width-fitted.width)/2,(self.bounds.size.height-fitted.height)/2,fitted.width,fitted.height);
}
- (int64_t)offsetUs {
  NSDictionary *anchor = _scene[@"anchor"];
  if (![anchor[@"kind"] isEqual:@"interval"]) return 0;
  return MAX(0,[self timeUs]-[anchor[@"start_us"] longLongValue]);
}
- (NSDictionary *)sample:(NSEvent *)event {
  NSRect rect = [self contentRect]; NSPoint p = [self convertPoint:event.locationInWindow fromView:nil];
  double x = fmin(1,fmax(0,(p.x-rect.origin.x)/fmax(1,rect.size.width))), y = fmin(1,fmax(0,(p.y-rect.origin.y)/fmax(1,rect.size.height)));
  int64_t time = [self offsetUs]; if (_samples.count) time = MAX(time, [_samples.lastObject[@"t_us"] longLongValue]);
  NSDictionary *anchor = _scene[@"anchor"]; if ([anchor[@"kind"] isEqual:@"interval"]) time = MIN(time, MAX(0,[anchor[@"end_us"] longLongValue]-[anchor[@"start_us"] longLongValue]-1));
  return @{@"x":@(llround(x*1000000)),@"y":@(llround(y*1000000)),@"t_us":@(time)};
}
- (void)beginStroke:(NSEvent *)event {
  if ([_tool isEqual:@"none"] || !_tool.length || !_scene || _seeking) return;
  NSPoint p = [self convertPoint:event.locationInWindow fromView:nil]; if (!NSPointInRect(p,[self contentRect])) return;
  NSDictionary *anchor = _scene[@"anchor"]; if ([anchor[@"kind"] isEqual:@"interval"] && ([self timeUs] < [anchor[@"start_us"] longLongValue] || [self timeUs] >= [anchor[@"end_us"] longLongValue])) return;
  _samples = [NSMutableArray new]; _drawingTool = [_tool copy]; _drawingColor = [_strokeColor copy];
  [_samples addObject:[self sample:event]]; _drawingStart = [_samples.firstObject[@"t_us"] longLongValue]; [_overlay setNeedsDisplay:YES];
}
- (void)continueStroke:(NSEvent *)event { if (_samples) { if (_samples.count < 50000) [_samples addObject:[self sample:event]]; [_overlay setNeedsDisplay:YES]; } }
- (NSDictionary *)currentDrawing {
  NSDictionary *anchor = _scene[@"anchor"];
  int64_t until = [anchor[@"kind"] isEqual:@"interval"] ? [anchor[@"end_us"] longLongValue]-[anchor[@"start_us"] longLongValue] : 0;
  NSArray *points = _samples;
  if (![_drawingTool isEqual:@"pen"] && points.count > 1) points = @[points.firstObject,points.lastObject];
  return @{@"id":NSUUID.UUID.UUIDString.lowercaseString,@"tool":_drawingTool ?: @"pen",@"color":_drawingColor ?: @"#FFCC66",@"width":@3500,@"visible_from_us":@(_drawingStart),@"visible_until_us":@(until),@"samples":points ?: @[]};
}
- (void)finishStroke {
  if (!_samples) return;
  if (_samples.count == 1) [_samples addObject:_samples.firstObject];
  NSDictionary *drawing = [self currentDrawing]; _samples = nil;
  if (self.onDrawing) { NSData *json = [NSJSONSerialization dataWithJSONObject:drawing options:0 error:nil]; self.onDrawing(@{@"drawingJson":[[NSString alloc] initWithData:json encoding:NSUTF8StringEncoding]}); }
  [_overlay setNeedsDisplay:YES];
}
- (NSColor *)color:(NSString *)hex { unsigned int value=0; if (hex.length==7) [[NSScanner scannerWithString:[hex substringFromIndex:1]] scanHexInt:&value]; return [NSColor colorWithRed:((value>>16)&255)/255.0 green:((value>>8)&255)/255.0 blue:(value&255)/255.0 alpha:1]; }
- (NSPoint)point:(NSDictionary *)sample rect:(NSRect)rect { return NSMakePoint(rect.origin.x+[sample[@"x"] doubleValue]/1000000*rect.size.width,rect.origin.y+[sample[@"y"] doubleValue]/1000000*rect.size.height); }
- (void)drawDrawing:(NSDictionary *)drawing rect:(NSRect)rect offset:(int64_t)offset live:(BOOL)live {
  NSArray *samples=drawing[@"samples"]; if (!samples.count) return;
  BOOL interval=[_scene[@"anchor"][@"kind"] isEqual:@"interval"];
  if (!live && interval && (offset<[drawing[@"visible_from_us"] longLongValue] || offset>=[drawing[@"visible_until_us"] longLongValue])) return;
  NSString *tool=drawing[@"tool"]; NSMutableArray *visible=[NSMutableArray new];
  for (NSDictionary *sample in samples) { if (live || !interval || ![tool isEqual:@"pen"] || [sample[@"t_us"] longLongValue]<=offset) [visible addObject:sample]; }
  if (!visible.count) return;
  CGFloat width=fmax(1.5,[drawing[@"width"] doubleValue]/1000000*rect.size.width);
  NSBezierPath *path=[NSBezierPath bezierPath]; path.lineWidth=width; path.lineCapStyle=NSLineCapStyleRound; path.lineJoinStyle=NSLineJoinStyleRound;
  NSPoint first=[self point:visible.firstObject rect:rect],last=[self point:visible.lastObject rect:rect];
  if ([tool isEqual:@"ellipse"]) [path appendBezierPathWithOvalInRect:NSMakeRect(fmin(first.x,last.x),fmin(first.y,last.y),fmax(1,fabs(last.x-first.x)),fmax(1,fabs(last.y-first.y)))];
  else { [path moveToPoint:first]; for (NSDictionary *sample in visible) [path lineToPoint:[self point:sample rect:rect]];
    if ([tool isEqual:@"arrow"]) { CGFloat angle=atan2(last.y-first.y,last.x-first.x),head=MAX(12,width*4); [path moveToPoint:NSMakePoint(last.x-head*cos(angle-0.48),last.y-head*sin(angle-0.48))]; [path lineToPoint:last]; [path lineToPoint:NSMakePoint(last.x-head*cos(angle+0.48),last.y-head*sin(angle+0.48))]; }
  }
  [[NSColor colorWithWhite:0 alpha:0.5] setStroke]; path.lineWidth=width+2; [path stroke]; [[self color:drawing[@"color"]] setStroke]; path.lineWidth=width; [path stroke];
}
- (void)drawOverlay {
  NSRect rect=[self contentRect]; [NSGraphicsContext saveGraphicsState]; NSRectClip(rect);
  NSDictionary *anchor=_scene[@"anchor"]; int64_t time=[self timeUs],offset=[self offsetUs];
  BOOL visible=![anchor[@"kind"] isEqual:@"interval"] || (time>=[anchor[@"start_us"] longLongValue] && time<[anchor[@"end_us"] longLongValue]);
  if (visible) for (NSDictionary *drawing in _scene[@"drawings"]) [self drawDrawing:drawing rect:rect offset:offset live:NO];
  if (_samples) [self drawDrawing:[self currentDrawing] rect:rect offset:offset live:YES];
  [NSGraphicsContext restoreGraphicsState];
}
@end
@implementation GPOverlay
- (BOOL)isFlipped { return YES; }
- (BOOL)isOpaque { return NO; }
- (void)drawRect:(NSRect)dirtyRect { [self.owner drawOverlay]; }
- (void)mouseDown:(NSEvent *)event { [self.owner beginStroke:event]; }
- (void)mouseDragged:(NSEvent *)event { [self.owner continueStroke:event]; }
- (void)mouseUp:(NSEvent *)event { [self.owner continueStroke:event]; [self.owner finishStroke]; }
@end
@interface GamePackPlayerManager : RCTViewManager @end
@implementation GamePackPlayerManager
RCT_EXPORT_MODULE(GamePackPlayer)
- (NSView *)view { return [GPPlayer new]; }
RCT_EXPORT_VIEW_PROPERTY(source, NSString)
RCT_EXPORT_VIEW_PROPERTY(paused, BOOL)
RCT_EXPORT_VIEW_PROPERTY(rate, float)
RCT_EXPORT_VIEW_PROPERTY(seekUs, double)
RCT_EXPORT_VIEW_PROPERTY(seekToken, NSInteger)
RCT_EXPORT_VIEW_PROPERTY(reviewEndUs, double)
RCT_EXPORT_VIEW_PROPERTY(sceneJson, NSString)
RCT_EXPORT_VIEW_PROPERTY(tool, NSString)
RCT_EXPORT_VIEW_PROPERTY(strokeColor, NSString)
RCT_EXPORT_VIEW_PROPERTY(onTime, RCTDirectEventBlock)
RCT_EXPORT_VIEW_PROPERTY(onDrawing, RCTDirectEventBlock)
@end
