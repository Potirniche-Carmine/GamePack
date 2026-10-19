#import "../native/macos/GPUpdateSupport.h"
#include "../native/shared/UpdateRelease.h"
#include "../native/shared/UpdateVersion.h"
#include <fcntl.h>
#include <sys/file.h>
#include <stdexcept>

// Standalone test executable. It is never linked into or shipped with GamePack.
// The stage command supplies a local fixture to the same production validators;
// the production updater only downloads fixed GitHub release URLs.
int main(int argc, char **argv) { @autoreleasepool {
  try {
    auto arg=[&](int n)->NSString * { if(n>=argc) throw std::runtime_error("Missing argument"); return [NSString stringWithUTF8String:argv[n]]; };
    NSString *command=arg(1);
    if([command isEqual:@"extract"]) GPExtractUpdateArchive(arg(2),arg(3));
    else if([command isEqual:@"verify"]) GPVerifyUpdateArchive(arg(2),arg(3));
    else if([command isEqual:@"validate"]) GPValidateUpdateApp(arg(2),arg(3),arg(4),argc>5?arg(5):nil);
    else if([command isEqual:@"identity"]) {
      NSData *json=[NSJSONSerialization dataWithJSONObject:GPUpdateProcessIdentity(arg(2).intValue) options:0 error:nil];
      fwrite(json.bytes,1,json.length,stdout);
    } else if([command isEqual:@"install-job"]) return GPRunUpdateInstallJob(arg(2));
    else if([command isEqual:@"quarantine"]) {
      GPQuarantineUpdate(arg(2),@"https://github.com/Potirniche-Carmine/GamePack/releases/download/v1.0.1/GamePack-macos-arm64.tar.gz");
      id properties=nil;
      if(![[NSURL fileURLWithPath:arg(2)] getResourceValue:&properties forKey:NSURLQuarantinePropertiesKey error:nil] || ![properties isKindOfClass:NSDictionary.class]) throw std::runtime_error("Quarantine attribute was not saved");
    } else if([command isEqual:@"stage"]) {
      // Usage: stage ARCHIVE SHA256 MANAGED_ROOT TAG
      NSString *archive=arg(2),*digest=arg(3),*root=arg(4),*tag=arg(5),*version=GPUpdateVersion(tag);
      NSString *current=[root stringByAppendingPathComponent:@"app/GamePack.app"];
      GPRequireManagedInstallation(root,current);
      NSString *installed=[NSDictionary dictionaryWithContentsOfFile:[current stringByAppendingPathComponent:@"Contents/Info.plist"]][@"CFBundleShortVersionString"];
      if(!gamepack::updates::newerStableVersion(version.UTF8String,installed.UTF8String?:"")) throw std::runtime_error("Fixture must be newer than installed app");
      NSString *updates=[root stringByAppendingPathComponent:@"updates"]; GPCreatePrivateDirectory(updates);
      int lock=open([updates stringByAppendingPathComponent:@"operation.lock"].fileSystemRepresentation,O_CREAT|O_RDWR|O_NOFOLLOW,0600);
      if(lock<0 || flock(lock,LOCK_EX|LOCK_NB)!=0) throw std::runtime_error("Another update is active");
      NSString *directory=[updates stringByAppendingPathComponent:NSUUID.UUID.UUIDString.lowercaseString]; GPCreatePrivateDirectory(directory);
      NSString *local=[directory stringByAppendingPathComponent:@"package.tar.gz"];
      if(![NSFileManager.defaultManager copyItemAtPath:archive toPath:local error:nil]) throw std::runtime_error("Could not copy fixture archive");
      GPVerifyUpdateArchive(local,digest);
      GPExtractUpdateArchive(local,[directory stringByAppendingPathComponent:@"payload"]);
      NSString *app=[directory stringByAppendingPathComponent:@"payload/GamePack.app"];
      GPValidateUpdateApp(app,version,GPUpdateArchitecture(),current);
      auto url=gamepack::updates::releaseUrl(tag.UTF8String,"macos",GPUpdateArchitecture().UTF8String,true);
      GPQuarantineUpdate(app,[NSString stringWithUTF8String:url.c_str()]);
      GPWriteUpdatePlist(@{@"version":version,@"tag":tag,@"sha256":digest},[directory stringByAppendingPathComponent:@"prepared.plist"]);
      GPWriteUpdatePlist(@{@"status":@"ready",@"version":version,@"directory":directory},[updates stringByAppendingPathComponent:@"state.plist"]);
      close(lock); puts(directory.UTF8String);
    } else throw std::runtime_error("Unknown command");
    return 0;
  } catch(std::exception const& error) { fprintf(stderr,"%s\n",error.what()); return 1; }
}}
