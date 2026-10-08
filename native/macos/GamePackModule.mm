#import <React/RCTBridgeModule.h>
#import <AppKit/AppKit.h>
#include "gamepack-core/src/lib.rs.h"

@interface GamePack : NSObject <RCTBridgeModule>
@end
@implementation GamePack
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
RCT_REMAP_METHOD(command, command:(NSString *)request resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
  try {
    auto response = gamepack::dispatch(rust::Str([[self root] UTF8String]), rust::Str([request UTF8String]));
    resolve([[NSString alloc] initWithBytes:response.data() length:response.size() encoding:NSUTF8StringEncoding]);
  } catch (const std::exception &e) { reject(@"engine", [NSString stringWithUTF8String:e.what()], nil); }
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
