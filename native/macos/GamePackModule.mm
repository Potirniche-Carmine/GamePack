#import <React/RCTBridgeModule.h>
#import <React/RCTEventEmitter.h>
#import <AppKit/AppKit.h>
#import <AVFoundation/AVFoundation.h>
#include "gamepack-core/src/lib.rs.h"

@interface GamePack : RCTEventEmitter <RCTBridgeModule>
@end
@implementation GamePack {
  id _keyMonitor;
  NSMutableArray *_windowObservers;
  NSSet<NSString *> *_shortcuts;
  NSString *_typingShortcut;
  BOOL _recordShortcut;
}
- (NSArray<NSString *> *)supportedEvents { return @[@"GamePackShortcut", @"GamePackWindowState"]; }
- (void)stopObserving {
  dispatch_async(dispatch_get_main_queue(), ^{
    if (self->_keyMonitor) { [NSEvent removeMonitor:self->_keyMonitor]; self->_keyMonitor = nil; }
    for (id token in self->_windowObservers) [NSNotificationCenter.defaultCenter removeObserver:token];
    self->_windowObservers = nil;
  });
}
- (void)startObserving {
  dispatch_async(dispatch_get_main_queue(), ^{
    if (self->_keyMonitor) return;
    __weak GamePack *weakSelf = self;
    self->_windowObservers = [NSMutableArray new];
    for (NSString *name in @[NSWindowDidEnterFullScreenNotification, NSWindowDidExitFullScreenNotification]) {
      id token = [NSNotificationCenter.defaultCenter addObserverForName:name object:nil queue:NSOperationQueue.mainQueue usingBlock:^(NSNotification *note) {
        GamePack *self = weakSelf; if (!self) return;
        if ([note.name isEqual:NSWindowDidEnterFullScreenNotification] || [note.name isEqual:NSWindowDidExitFullScreenNotification])
          [self sendEventWithName:@"GamePackWindowState" body:@{@"fullScreen":@([note.name isEqual:NSWindowDidEnterFullScreenNotification])}];
      }];
      [self->_windowObservers addObject:token];
    }
    self->_keyMonitor = [NSEvent addLocalMonitorForEventsMatchingMask:NSEventMaskKeyDown handler:^NSEvent *(NSEvent *event) {
      GamePack *self = weakSelf;
      if (!self || !NSApp.isActive || event.window != NSApp.keyWindow || event.modifierFlags & NSEventModifierFlagControl) return event;
      NSString *key = @{@123:@"ArrowLeft", @124:@"ArrowRight", @125:@"ArrowDown", @126:@"ArrowUp", @116:@"PageUp", @121:@"PageDown", @49:@"Space", @36:@"Enter", @76:@"Enter", @51:@"Backspace", @117:@"Delete", @115:@"Home", @119:@"End", @53:@"Escape", @48:@"Tab"}[@(event.keyCode)];
      if (!key) key = [event charactersByApplyingModifiers:0].uppercaseString;
      if (!key.length || [key isEqual:@"Tab"]) return event;
      NSMutableArray *parts = [NSMutableArray new];
      if (event.modifierFlags & NSEventModifierFlagCommand) [parts addObject:@"Mod"];
      if (event.modifierFlags & NSEventModifierFlagOption) [parts addObject:@"Alt"];
      if (event.modifierFlags & NSEventModifierFlagShift) [parts addObject:@"Shift"];
      [parts addObject:key]; NSString *chord = [parts componentsJoinedByString:@"+"];
      NSResponder *responder = event.window.firstResponder;
      BOOL editing = [responder isKindOfClass:NSTextView.class] || [responder isKindOfClass:NSTextField.class];
      if (!self->_recordShortcut && (![self->_shortcuts containsObject:chord] || (editing && ![chord isEqual:self->_typingShortcut] && ![chord isEqual:@"Escape"]))) return event;
      NSMutableDictionary *payload = [@{@"chord":chord, @"repeat":@(event.isARepeat)} mutableCopy];
      // Native text may be newer than the last bridged onChangeText event.
      if (!self->_recordShortcut && editing && [chord isEqual:self->_typingShortcut]) {
        if ([responder isKindOfClass:NSTextView.class]) payload[@"text"] = [(NSTextView *)responder string];
        else payload[@"text"] = [(NSTextField *)responder stringValue];
      }
      [self sendEventWithName:@"GamePackShortcut" body:payload];
      return nil;
    }];
  });
}
RCT_EXPORT_METHOD(configureShortcuts:(NSArray<NSString *> *)chords recording:(BOOL)recording typingShortcut:(NSString *)typingShortcut) {
  dispatch_async(dispatch_get_main_queue(), ^{ self->_shortcuts = [NSSet setWithArray:chords]; self->_recordShortcut = recording; self->_typingShortcut = typingShortcut; });
}
RCT_EXPORT_METHOD(setFullScreen:(BOOL)enabled) {
  dispatch_async(dispatch_get_main_queue(), ^{
    NSWindow *window = NSApp.keyWindow ?: NSApp.mainWindow;
    if (window && ((window.styleMask & NSWindowStyleMaskFullScreen) != 0) != enabled) [window toggleFullScreen:nil];
  });
}
RCT_EXPORT_MODULE(GamePack)
+ (BOOL)requiresMainQueueSetup { return NO; }
- (dispatch_queue_t)methodQueue {
  static dispatch_queue_t queue;
  static dispatch_once_t once;
  dispatch_once(&once, ^{ queue = dispatch_queue_create("app.gamepack.engine", DISPATCH_QUEUE_SERIAL); });
  return queue;
}
- (NSString *)root {
  NSString *override = NSProcessInfo.processInfo.environment[@"GAMEPACK_HOME"];
  return override.length ? [override stringByExpandingTildeInPath] : [NSHomeDirectory() stringByAppendingPathComponent:@".gamepack"];
}
RCT_REMAP_METHOD(dataDirectory, dataDirectoryWithResolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) { resolve([self root]); }
RCT_EXPORT_METHOD(setAppearance:(NSString *)theme) {
  if (![@[@"system", @"light", @"dark"] containsObject:theme]) return;
  dispatch_async(dispatch_get_main_queue(), ^{
    NSAppearance *appearance = [theme isEqual:@"system"] ? nil : [NSAppearance appearanceNamed:[theme isEqual:@"dark"] ? NSAppearanceNameDarkAqua : NSAppearanceNameAqua];
    NSApp.appearance = appearance;
    for (NSWindow *window in NSApp.windows) {
      window.appearance = appearance;
      window.backgroundColor = NSColor.windowBackgroundColor;
    }
  });
}
RCT_REMAP_METHOD(command, command:(NSString *)request resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
  try {
    auto response = gamepack::dispatch(rust::Str([[self root] UTF8String]), rust::Str([request UTF8String]));
    resolve([[NSString alloc] initWithBytes:response.data() length:response.size() encoding:NSUTF8StringEncoding]);
  } catch (const std::exception &e) { reject(@"engine", [NSString stringWithUTF8String:e.what()], nil); }
}
// Filmstrip decoding is isolated from the engine queue and never delays playback or commands.
RCT_REMAP_METHOD(thumbnails, thumbnails:(NSString *)path mediaId:(NSString *)mediaId resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
  NSRegularExpression *identifier = [NSRegularExpression regularExpressionWithPattern:@"^blake3:([0-9a-f]{64}):([0-9]{1,20})$" options:0 error:nil];
  NSTextCheckingResult *match = [identifier firstMatchInString:mediaId ?: @"" options:0 range:NSMakeRange(0, mediaId.length)];
  if (!match || !path.isAbsolutePath) { resolve(@[]); return; }
  NSString *cacheKey = [NSString stringWithFormat:@"%@-%@", [mediaId substringWithRange:[match rangeAtIndex:1]], [mediaId substringWithRange:[match rangeAtIndex:2]]];
  NSString *directory = [[[self root] stringByAppendingPathComponent:@"thumbnails"] stringByAppendingPathComponent:cacheKey];
  static dispatch_queue_t queue;
  static dispatch_once_t once;
  dispatch_once(&once, ^{ queue = dispatch_queue_create("app.gamepack.thumbnails", dispatch_queue_attr_make_with_qos_class(DISPATCH_QUEUE_SERIAL, QOS_CLASS_UTILITY, 0)); });
  dispatch_async(queue, ^{
    @autoreleasepool {
      @try {
        NSFileManager *files = NSFileManager.defaultManager;
        if (![files createDirectoryAtPath:directory withIntermediateDirectories:YES attributes:nil error:nil]) { resolve(@[]); return; }
        const NSInteger count = 12;
        NSMutableArray<NSString *> *paths = [NSMutableArray new];
        NSMutableArray<NSString *> *urls = [NSMutableArray new];
        BOOL complete = YES;
        for (NSInteger index = 0; index < count; index++) {
          NSString *file = [directory stringByAppendingPathComponent:[NSString stringWithFormat:@"frame-%02ld.jpg", (long)index]];
          [paths addObject:file]; [urls addObject:[NSURL fileURLWithPath:file].absoluteString];
          if ([[files attributesOfItemAtPath:file error:nil][NSFileSize] unsignedLongLongValue] == 0) complete = NO;
        }
        if (complete) { resolve(urls); return; }
        AVURLAsset *asset = [AVURLAsset URLAssetWithURL:[NSURL fileURLWithPath:path] options:nil];
        double seconds = CMTimeGetSeconds(asset.duration);
        if (!isfinite(seconds) || seconds <= 0) { resolve(@[]); return; }
        AVAssetImageGenerator *generator = [AVAssetImageGenerator assetImageGeneratorWithAsset:asset];
        generator.appliesPreferredTrackTransform = YES;
        generator.maximumSize = CGSizeMake(320, 180);
        generator.requestedTimeToleranceBefore = CMTimeMakeWithSeconds(0.25, 600);
        generator.requestedTimeToleranceAfter = CMTimeMakeWithSeconds(0.25, 600);
        for (NSInteger index = 0; index < count; index++) {
          @autoreleasepool {
            if ([[files attributesOfItemAtPath:paths[index] error:nil][NSFileSize] unsignedLongLongValue] > 0) continue;
            CMTime at = CMTimeMakeWithSeconds(seconds * ((double)index + 0.5) / count, 600);
            CGImageRef image = [generator copyCGImageAtTime:at actualTime:nullptr error:nil];
            if (!image) { resolve(@[]); return; }
            NSBitmapImageRep *bitmap = [[NSBitmapImageRep alloc] initWithCGImage:image];
            CGImageRelease(image);
            NSData *jpeg = [bitmap representationUsingType:NSBitmapImageFileTypeJPEG properties:@{NSImageCompressionFactor:@0.76}];
            if (!jpeg.length || ![jpeg writeToFile:paths[index] options:NSDataWritingAtomic error:nil]) { resolve(@[]); return; }
          }
        }
        resolve(urls);
      } @catch (NSException *exception) { resolve(@[]); }
    }
  });
}
RCT_REMAP_METHOD(chooseVideo, chooseVideoWithResolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
  dispatch_async(dispatch_get_main_queue(), ^{
    NSOpenPanel *panel = [NSOpenPanel openPanel];
    panel.title = @"Add a video";
    panel.message = @"GamePack keeps one original-quality copy in your library.";
    panel.allowedFileTypes = @[@"mp4", @"mov", @"m4v", @"m4a"];
    panel.allowsMultipleSelection = NO; panel.canChooseDirectories = NO;
    [panel beginWithCompletionHandler:^(NSModalResponse result) { resolve(result == NSModalResponseOK ? panel.URL.path : (id)kCFNull); }];
  });
}
@end
