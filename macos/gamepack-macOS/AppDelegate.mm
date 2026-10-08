#import "AppDelegate.h"

#import <React/RCTBundleURLProvider.h>
#import <ReactAppDependencyProvider/RCTAppDependencyProvider.h>

@implementation AppDelegate

- (void)applicationDidFinishLaunching:(NSNotification *)notification
{
  self.moduleName = @"GamePack";
  // You can add your custom initial props in the dictionary below.
  // They will be passed down to the ViewController used by React Native.
  self.initialProps = @{};
  self.dependencyProvider = [RCTAppDependencyProvider new];
  
  return [super applicationDidFinishLaunching:notification];
}

- (void)loadReactNativeWindow:(NSDictionary *)launchOptions
{
  NSView *root = [self.rootViewFactory viewWithModuleName:self.moduleName initialProperties:self.initialProps launchOptions:launchOptions];
  root.frame = NSMakeRect(0, 0, 1400, 840);
  self.window = [[NSWindow alloc] initWithContentRect:root.frame styleMask:NSWindowStyleMaskTitled | NSWindowStyleMaskResizable | NSWindowStyleMaskClosable | NSWindowStyleMaskMiniaturizable backing:NSBackingStoreBuffered defer:NO];
  self.window.title = @"GamePack";
  self.window.minSize = NSMakeSize(1080, 700);
  self.window.backgroundColor = NSColor.windowBackgroundColor;
  self.window.titlebarAppearsTransparent = YES;
  NSViewController *controller = [NSViewController new]; controller.view = root;
  self.window.contentViewController = controller;
  [self.window center]; [self.window makeKeyAndOrderFront:self];
  [NSApp activateIgnoringOtherApps:YES];
}
- (BOOL)applicationShouldTerminateAfterLastWindowClosed:(NSApplication *)sender { return YES; }

- (NSURL *)sourceURLForBridge:(RCTBridge *)bridge
{
  return [self bundleURL];
}

- (NSURL *)bundleURL
{
#if DEBUG
  return [[RCTBundleURLProvider sharedSettings] jsBundleURLForBundleRoot:@"index"];
#else
  return [[NSBundle mainBundle] URLForResource:@"main" withExtension:@"jsbundle"];
#endif
}

/// This method controls whether the `concurrentRoot`feature of React18 is turned on or off.
///
/// @see: https://reactjs.org/blog/2022/03/29/react-v18.html
/// @note: This requires to be rendering on Fabric (i.e. on the New Architecture).
/// @return: `true` if the `concurrentRoot` feature is enabled. Otherwise, it returns `false`.
- (BOOL)concurrentRootEnabled
{
#ifdef RN_FABRIC_ENABLED
  return true;
#else
  return false;
#endif
}

@end
