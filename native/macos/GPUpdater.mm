#import "GPUpdater.h"
#import "GPUpdateSupport.h"
#import <AppKit/AppKit.h>
#include "../shared/UpdateRelease.h"
#include "../shared/UpdateVersion.h"
#include <sys/file.h>
#include <fcntl.h>
#include <stdexcept>

static void Check(bool valid,char const *message) { if(!valid) throw std::runtime_error(message); }
static NSString *Path(NSString *base,NSString *name) { return [base stringByAppendingPathComponent:name]; }
static NSString *InstalledVersion() { return [NSBundle.mainBundle objectForInfoDictionaryKey:@"CFBundleShortVersionString"]; }
static bool ActiveProcess(id value) {
  return [value isKindOfClass:NSDictionary.class] && [value[@"pid"] isKindOfClass:NSNumber.class] && GPUpdateProcessMatches([value[@"pid"] intValue],value);
}

@interface GPUpdateDownload : NSObject <NSURLSessionDataDelegate>
@property(nonatomic) NSFileHandle *file;
@property(nonatomic) NSError *failure;
@property(nonatomic) dispatch_semaphore_t complete;
@property(nonatomic) uint64_t limit;
@property(nonatomic) uint64_t received;
@property(nonatomic) NSUInteger redirects;
@property(nonatomic) BOOL metadata;
@property(nonatomic,copy) void (^progress)(double);
@end
@implementation GPUpdateDownload
- (void)URLSession:(NSURLSession *)session task:(NSURLSessionTask *)task willPerformHTTPRedirection:(NSHTTPURLResponse *)response newRequest:(NSURLRequest *)request completionHandler:(void (^)(NSURLRequest *))completion {
  NSURL *url=request.URL; NSSet *hosts=self.metadata?[NSSet setWithObject:@"api.github.com"]:[NSSet setWithArray:@[@"github.com",@"release-assets.githubusercontent.com",@"objects.githubusercontent.com",@"github-releases.githubusercontent.com"]];
  BOOL safe=[url.scheme isEqual:@"https"] && [hosts containsObject:url.host.lowercaseString] && !url.user && !url.password && (!url.port || url.port.intValue==443) && ++self.redirects<=5;
  if(!safe) self.failure=[NSError errorWithDomain:@"GamePackUpdate" code:1 userInfo:@{NSLocalizedDescriptionKey:@"GitHub redirected the download to an unsupported address. Try again later."}];
  completion(safe?request:nil);
}
- (void)URLSession:(NSURLSession *)session dataTask:(NSURLSessionDataTask *)task didReceiveResponse:(NSURLResponse *)response completionHandler:(void (^)(NSURLSessionResponseDisposition))completion {
  auto status=[(NSHTTPURLResponse *)response statusCode];
  if(status!=200 || response.expectedContentLength>(int64_t)self.limit) {
    NSString *message=status==403||status==429?@"GitHub’s request limit was reached. Try again later.":status==404?@"This release is no longer available. Check for updates again.":@"The update could not be downloaded. Try again later.";
    self.failure=[NSError errorWithDomain:@"GamePackUpdate" code:status userInfo:@{NSLocalizedDescriptionKey:message}]; completion(NSURLSessionResponseCancel); return;
  } completion(NSURLSessionResponseAllow);
}
- (void)URLSession:(NSURLSession *)session dataTask:(NSURLSessionDataTask *)task didReceiveData:(NSData *)data {
  self.received+=data.length;
  if(self.received>self.limit) { self.failure=[NSError errorWithDomain:@"GamePackUpdate" code:2 userInfo:@{NSLocalizedDescriptionKey:@"The update download is larger than expected. Try again."}]; [task cancel]; return; }
  NSError *error=nil; if(![self.file writeData:data error:&error]) { self.failure=error; [task cancel]; return; }
  if(self.progress && task.countOfBytesExpectedToReceive>0) self.progress((double)self.received/task.countOfBytesExpectedToReceive);
}
- (void)URLSession:(NSURLSession *)session task:(NSURLSessionTask *)task didCompleteWithError:(NSError *)error { if(!self.failure) self.failure=error; dispatch_semaphore_signal(self.complete); }
@end

static void Download(NSString *url,NSString *destination,uint64_t maximum,BOOL metadata,void (^progress)(double)) {
  int fd=open(destination.fileSystemRepresentation,O_WRONLY|O_CREAT|O_EXCL|O_NOFOLLOW,0600); Check(fd>=0,"Could not create the update download. Check available space and permissions.");
  GPUpdateDownload *delegate=[GPUpdateDownload new]; delegate.file=[[NSFileHandle alloc] initWithFileDescriptor:fd closeOnDealloc:YES]; delegate.limit=maximum; delegate.metadata=metadata; delegate.complete=dispatch_semaphore_create(0); delegate.progress=progress;
  NSURLSessionConfiguration *configuration=NSURLSessionConfiguration.ephemeralSessionConfiguration;
  configuration.timeoutIntervalForRequest=30; configuration.timeoutIntervalForResource=900; configuration.requestCachePolicy=NSURLRequestReloadIgnoringLocalCacheData;
  configuration.HTTPCookieStorage=nil; configuration.URLCredentialStorage=nil;
  NSOperationQueue *queue=[NSOperationQueue new]; queue.maxConcurrentOperationCount=1;
  NSURLSession *session=[NSURLSession sessionWithConfiguration:configuration delegate:delegate delegateQueue:queue];
  NSMutableURLRequest *request=[NSMutableURLRequest requestWithURL:[NSURL URLWithString:url]];
  [request setValue:@"GamePack" forHTTPHeaderField:@"User-Agent"]; [request setValue:@"application/vnd.github+json" forHTTPHeaderField:@"Accept"];
  [request setValue:@"2022-11-28" forHTTPHeaderField:@"X-GitHub-Api-Version"]; [request setValue:@"no-cache" forHTTPHeaderField:@"Cache-Control"];
  NSURLSessionDataTask *task=[session dataTaskWithRequest:request]; [task resume];
  bool timedOut=dispatch_semaphore_wait(delegate.complete,dispatch_time(DISPATCH_TIME_NOW,905*NSEC_PER_SEC))!=0;
  if(timedOut) { [task cancel]; dispatch_semaphore_wait(delegate.complete,dispatch_time(DISPATCH_TIME_NOW,5*NSEC_PER_SEC)); }
  [session invalidateAndCancel];
  // Delegate I/O is serial. Close behind pending writes, including cancellation.
  [queue addOperationWithBlock:^{ [delegate.file closeFile]; }];
  [queue waitUntilAllOperationsAreFinished];
  Check(!timedOut,"The update download timed out. Check your connection and try again.");
  if(delegate.failure) {
    if([delegate.failure.domain isEqual:@"GamePackUpdate"]) throw std::runtime_error(delegate.failure.localizedDescription.UTF8String);
    throw std::runtime_error("Could not download the update. Check your connection, available space, and try again.");
  }
}
static NSDictionary *Asset(NSDictionary *release,NSString *name) {
  NSArray *assets=release[@"assets"]; Check([assets isKindOfClass:NSArray.class] && assets.count<=1000,"GitHub returned invalid update information."); NSDictionary *found=nil;
  for(id value in assets) if([value isKindOfClass:NSDictionary.class] && [value[@"name"] isEqual:name]) { Check(!found,"GitHub returned duplicate update assets."); found=value; }
  Check(found && [found[@"state"] isEqual:@"uploaded"] && [found[@"size"] isKindOfClass:NSNumber.class] && [found[@"size"] longLongValue]>0,"A complete update download is not available for this Mac yet."); return found;
}
static NSString *DownloadURL(NSString *tag) {
  auto url=gamepack::updates::releaseUrl(tag.UTF8String?:"","macos",GPUpdateArchitecture().UTF8String,true);
  Check(!url.empty(),"The update version is invalid. Check for updates again."); return [NSString stringWithUTF8String:url.c_str()];
}

@implementation GPUpdater {
  NSLock *_lock;
  BOOL _working;
  NSString *_root;
  NSString *_statePath;
}
+ (instancetype)shared { static GPUpdater *value; static dispatch_once_t once; dispatch_once(&once,^{value=[GPUpdater new];}); return value; }
- (instancetype)init { if((self=[super init])) { _lock=[NSLock new]; } return self; }
- (void)initializePaths {
  _root=GPUpdateRoot(); GPCreatePrivateDirectory(Path(_root,@"updates")); _statePath=Path(_root,@"updates/state.plist");
}
- (NSDictionary *)state {
  [self initializePaths];
  NSDictionary *saved=GPReadUpdatePlist(_statePath) ?: @{@"status":@"idle"};
  NSString *status=saved[@"status"],*version=saved[@"version"];
  Check([@[@"idle",@"downloading",@"verifying",@"ready",@"installing",@"error"] containsObject:status?:@""],"The saved update information is invalid. Check for updates again.");
  if(([status isEqual:@"ready"]||[status isEqual:@"installing"]) && [version isKindOfClass:NSString.class] && !gamepack::updates::newerStableVersion(version.UTF8String,InstalledVersion().UTF8String?:"")) { saved=@{@"status":@"idle"}; GPWriteUpdatePlist(saved,_statePath); }
  // A prior app process cannot keep a vanished download alive after a restart.
  if(([saved[@"status"] isEqual:@"downloading"]||[saved[@"status"] isEqual:@"verifying"]||[saved[@"status"] isEqual:@"installing"]) && !ActiveProcess(saved[@"process"])) {
    saved=@{@"status":@"error",@"error":@"The update was interrupted. Check for updates and try again."}; GPWriteUpdatePlist(saved,_statePath);
  }
  NSMutableDictionary *publicState=[NSMutableDictionary new]; for(NSString *key in @[@"status",@"version",@"error",@"progress"]) if(saved[key]) publicState[key]=saved[key]; return publicState;
}
- (void)prepare:(NSString *)tag {
  [self initializePaths]; GPRequireManagedInstallation(_root,NSBundle.mainBundle.bundlePath);
  NSString *version=GPUpdateVersion(tag); Check(gamepack::updates::newerStableVersion(tag.UTF8String,InstalledVersion().UTF8String?:""),"This update is not newer than the installed app. Check for updates again.");
  [_lock lock]; if(_working) { [_lock unlock]; throw std::runtime_error("An update is already in progress."); } _working=YES; [_lock unlock];
  int lockFD=open(Path(_root,@"updates/operation.lock").fileSystemRepresentation,O_CREAT|O_RDWR|O_NOFOLLOW,0600);
  if(lockFD<0 || flock(lockFD,LOCK_EX|LOCK_NB)!=0) { if(lockFD>=0) close(lockFD); _working=NO; throw std::runtime_error("Another GamePack window is updating. Try again after it finishes."); }
  NSString *root=_root,*statePath=_statePath,*directory=Path(Path(root,@"updates"),NSUUID.UUID.UUIDString.lowercaseString);
  try { GPCreatePrivateDirectory(directory); GPWriteUpdatePlist(@{@"status":@"downloading",@"version":version,@"progress":@0,@"directory":directory,@"process":GPUpdateProcessIdentity(getpid())},statePath); }
  catch(...) { close(lockFD); _working=NO; throw; }
  dispatch_async(dispatch_get_global_queue(QOS_CLASS_UTILITY,0),^{ @autoreleasepool {
    try {
      NSString *encoded=[tag stringByReplacingOccurrencesOfString:@"+" withString:@"%2B"];
      NSString *metadata=Path(directory,@"release.json"); Download([@"https://api.github.com/repos/Potirniche-Carmine/GamePack/releases/tags/" stringByAppendingString:encoded],metadata,1024*1024,YES,nil);
      id release=[NSJSONSerialization JSONObjectWithData:[NSData dataWithContentsOfFile:metadata] options:0 error:nil];
      Check([release isKindOfClass:NSDictionary.class] && [release[@"tag_name"] isEqual:tag] && [release[@"draft"] isEqual:@NO] && [release[@"prerelease"] isEqual:@NO] && [release[@"published_at"] isKindOfClass:NSString.class] && [release[@"published_at"] length]>0,"This update is not a published stable release. Check for updates again.");
      NSString *name=[NSString stringWithFormat:@"GamePack-macos-%@.tar.gz",GPUpdateArchitecture()]; NSDictionary *asset=Asset(release,name);
      uint64_t size=[asset[@"size"] unsignedLongLongValue]; Check(size<=512ULL*1024*1024,"The update package is too large.");
      NSString *url=DownloadURL(tag),*checksum=nil; id digest=asset[@"digest"];
      if([digest isKindOfClass:NSString.class] && [digest hasPrefix:@"sha256:"]) checksum=[digest substringFromIndex:7];
      else {
        NSDictionary *sidecar=Asset(release,[name stringByAppendingString:@".sha256"]); Check([sidecar[@"size"] unsignedLongLongValue]<=4096,"The release checksum is invalid.");
        NSString *file=Path(directory,@"checksum.txt"); Download([url stringByAppendingString:@".sha256"],file,4096,NO,nil);
        NSString *text=[NSString stringWithContentsOfFile:file encoding:NSUTF8StringEncoding error:nil];
        NSString *pattern=[NSString stringWithFormat:@"\\A([0-9a-fA-F]{64})[ \\t]+\\*?%@[\\r\\n]*\\z",[NSRegularExpression escapedPatternForString:name]];
        NSTextCheckingResult *match=[[NSRegularExpression regularExpressionWithPattern:pattern options:0 error:nil] firstMatchInString:text?:@"" options:0 range:NSMakeRange(0,text.length)];
        Check(match!=nil,"The release checksum is invalid. Try again later."); checksum=[text substringWithRange:[match rangeAtIndex:1]];
      }
      NSString *archive=Path(directory,@"package.tar.gz"); __block NSTimeInterval last=0;
      NSDictionary *process=GPUpdateProcessIdentity(getpid());
      Download(url,archive,size,NO,^(double fraction) { auto now=NSDate.timeIntervalSinceReferenceDate; if(now-last<.3) return; last=now;
        try { GPWriteUpdatePlist(@{@"status":@"downloading",@"version":version,@"progress":@(std::min(1.0,fraction)),@"directory":directory,@"process":process},statePath); } catch(...) {} });
      Check([NSFileManager.defaultManager attributesOfItemAtPath:archive error:nil].fileSize==size,"The update download is incomplete. Try again.");
      GPWriteUpdatePlist(@{@"status":@"verifying",@"version":version,@"directory":directory,@"process":process},statePath);
      GPVerifyUpdateArchive(archive,checksum); GPExtractUpdateArchive(archive,Path(directory,@"payload"));
      NSString *app=Path(directory,@"payload/GamePack.app"); GPValidateUpdateApp(app,version,GPUpdateArchitecture(),NSBundle.mainBundle.bundlePath); GPQuarantineUpdate(app,url);
      GPWriteUpdatePlist(@{@"version":version,@"tag":tag,@"sha256":checksum},Path(directory,@"prepared.plist"));
      GPWriteUpdatePlist(@{@"status":@"ready",@"version":version,@"directory":directory},statePath);
    } catch(std::exception const& error) { try { GPWriteUpdatePlist(@{@"status":@"error",@"error":[NSString stringWithUTF8String:error.what()]},statePath); } catch(...) {} }
    close(lockFD); [self->_lock lock]; self->_working=NO; [self->_lock unlock];
  }});
}
- (void)install {
  [self initializePaths]; GPRequireManagedInstallation(_root,NSBundle.mainBundle.bundlePath);
  NSDictionary *state=GPReadUpdatePlist(_statePath); Check([state[@"status"] isEqual:@"ready"],"The update is not ready. Check for updates again.");
  NSString *directory=state[@"directory"]; Check([directory isKindOfClass:NSString.class] && [directory hasPrefix:[Path(_root,@"updates") stringByAppendingString:@"/"]] && [GPCanonicalUpdatePath(directory) isEqual:directory],"The update staging location is invalid.");
  NSDictionary *prepared=GPReadUpdatePlist(Path(directory,@"prepared.plist")); NSString *version=GPUpdateVersion(prepared[@"version"]);
  Check(gamepack::updates::newerStableVersion(version.UTF8String,InstalledVersion().UTF8String?:""),"This update is no longer newer than the installed app. Check for updates again.");
  NSString *app=Path(directory,@"payload/GamePack.app"); GPVerifyUpdateArchive(Path(directory,@"package.tar.gz"),prepared[@"sha256"]); GPValidateUpdateApp(app,version,GPUpdateArchitecture(),NSBundle.mainBundle.bundlePath);
  NSString *helper=Path(NSBundle.mainBundle.bundlePath,@"Contents/Helpers/GamePackUpdateHelper"); Check([NSFileManager.defaultManager isExecutableFileAtPath:helper],"This GamePack installation cannot install updates. Use the release installer first.");
  NSString *jobPath=Path(directory,@"job.plist"); GPWriteUpdatePlist(@{@"root":_root,@"destination":Path(_root,@"app/GamePack.app"),@"staged":app,@"version":version,@"process":GPUpdateProcessIdentity(getpid())},jobPath);
  [NSFileManager.defaultManager removeItemAtPath:Path(directory,@"helper-ready.plist") error:nil];
  [NSFileManager.defaultManager removeItemAtPath:Path(directory,@"install-permitted.plist") error:nil];
  NSTask *task=[NSTask new]; task.executableURL=[NSURL fileURLWithPath:helper]; task.arguments=@[jobPath]; task.standardInput=NSFileHandle.fileHandleWithNullDevice; task.standardOutput=NSFileHandle.fileHandleWithNullDevice; task.standardError=NSFileHandle.fileHandleWithNullDevice;
  Check([task launchAndReturnError:nil],"Could not start the update installer. Try again.");
  try {
    auto deadline=NSDate.timeIntervalSinceReferenceDate+30;
    while(task.running && ![NSFileManager.defaultManager fileExistsAtPath:Path(directory,@"helper-ready.plist")] && NSDate.timeIntervalSinceReferenceDate<deadline) usleep(50000);
    NSDictionary *helperIdentity=GPUpdateProcessIdentity(task.processIdentifier);
    NSDictionary *ready=GPReadUpdatePlist(Path(directory,@"helper-ready.plist"));
    Check([ready[@"process"] isEqual:helperIdentity],"The update installer could not prepare the restart. Check for updates and try again.");
    GPWriteUpdatePlist(@{@"status":@"installing",@"version":version,@"directory":directory,@"process":helperIdentity},_statePath);
    GPWriteUpdatePlist(@{@"helper":helperIdentity,@"parent":GPUpdateProcessIdentity(getpid())},Path(directory,@"install-permitted.plist"));
  } catch(...) { if(task.running) [task terminate]; throw; }
}
@end
