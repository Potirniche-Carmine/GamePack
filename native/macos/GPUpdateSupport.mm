#import "GPUpdateSupport.h"
#import <AppKit/AppKit.h>
#import <Security/Security.h>
#import <CoreServices/CoreServices.h>
#include "../shared/UpdateVersion.h"
#include "../shared/UpdateArchiveLimits.h"
#include <CommonCrypto/CommonDigest.h>
#include <libproc.h>
#include <sys/sysctl.h>
#include <sys/stat.h>
#include <sys/file.h>
#include <fcntl.h>
#include <mach/machine.h>
#include <zlib.h>
#include <set>
#include <map>
#include <vector>
#include <stdexcept>
#include <memory>

static void Require(bool valid, char const *message) { if (!valid) throw std::runtime_error(message); }
static NSString *Join(NSString *a, NSString *b) { return [a stringByAppendingPathComponent:b]; }
static NSString *Canonical(NSString *path) {
  if(![path isKindOfClass:NSString.class]) return nil;
  char resolved[PATH_MAX];
  return realpath(path.fileSystemRepresentation,resolved)?[NSString stringWithUTF8String:resolved]:path.stringByStandardizingPath.stringByResolvingSymlinksInPath;
}
static bool Inside(NSString *path, NSString *root) { return [path hasPrefix:[root stringByAppendingString:@"/"]]; }
NSString *GPCanonicalUpdatePath(NSString *path) { return Canonical(path); }
static void Move(NSString *from, NSString *to) { Require([NSFileManager.defaultManager moveItemAtPath:from toPath:to error:nil], "Could not replace GamePack. Check the app folder’s permissions and try again."); }

NSString *GPUpdateArchitecture() {
  int arm = 0; size_t length = sizeof(arm);
  if (sysctlbyname("hw.optional.arm64", &arm, &length, nullptr, 0) == 0 && arm) return @"arm64";
#if defined(__arm64__)
  return @"arm64";
#else
  return @"x64";
#endif
}
NSString *GPUpdateRoot() {
  NSString *path = NSProcessInfo.processInfo.environment[@"GAMEPACK_HOME"] ?: [NSHomeDirectory() stringByAppendingPathComponent:@".gamepack"];
  Require(path.isAbsolutePath, "GAMEPACK_HOME must be an absolute folder to install updates.");
  return Canonical(path);
}
NSString *GPUpdateVersion(NSString *tag) {
  Require([tag isKindOfClass:NSString.class], "The update version is invalid. Check for updates again.");
  auto parsed = gamepack::updates::parseStableVersion(tag.UTF8String ?: "");
  Require(parsed.has_value(), "The update version is invalid. Check for updates again.");
  return [NSString stringWithUTF8String:parsed->normalized().c_str()];
}
void GPRequireManagedInstallation(NSString *root, NSString *app) {
  Require(root.isAbsolutePath && [Canonical(root) isEqual:root], "The GamePack data folder is not supported for automatic updates.");
  NSString *expected = Join(root, @"app/GamePack.app");
  Require([Canonical(app) isEqual:expected], "Install GamePack in its data folder before updating here. Use the release installer first.");
  Require([NSFileManager.defaultManager isWritableFileAtPath:Join(root, @"app")], "The GamePack app folder is not writable. Check its permissions and try again.");
}
void GPCreatePrivateDirectory(NSString *path) {
  Require([NSFileManager.defaultManager createDirectoryAtPath:path withIntermediateDirectories:YES attributes:@{NSFilePosixPermissions:@0700} error:nil], "Could not create the update folder. Check available space and permissions.");
  struct stat status{};
  Require(lstat(path.fileSystemRepresentation, &status) == 0 && S_ISDIR(status.st_mode) && status.st_uid == getuid() && [Canonical(path) isEqual:path], "The update folder must be a regular folder owned by your account.");
  Require(chmod(path.fileSystemRepresentation, 0700) == 0, "Could not secure the update folder.");
}
void GPWriteUpdatePlist(NSDictionary *value, NSString *path) {
  NSData *data = [NSPropertyListSerialization dataWithPropertyList:value format:NSPropertyListBinaryFormat_v1_0 options:0 error:nil];
  Require(data && [data writeToFile:path options:NSDataWritingAtomic error:nil], "Could not save update progress. Check available space and permissions.");
  chmod(path.fileSystemRepresentation, 0600);
}
NSDictionary *GPReadUpdatePlist(NSString *path) {
  struct stat status{};
  if (lstat(path.fileSystemRepresentation, &status) != 0) return nil;
  Require(S_ISREG(status.st_mode) && status.st_uid == getuid() && status.st_size <= 1024*1024, "The saved update information is invalid. Check for updates again.");
  NSData *data = [NSData dataWithContentsOfFile:path];
  id value = data ? [NSPropertyListSerialization propertyListWithData:data options:NSPropertyListImmutable format:nil error:nil] : nil;
  Require([value isKindOfClass:NSDictionary.class], "The saved update information is invalid. Check for updates again.");
  return value;
}
NSString *GPUpdateSHA256(NSString *path) {
  int fd = open(path.fileSystemRepresentation, O_RDONLY|O_NOFOLLOW);
  Require(fd >= 0, "The downloaded update could not be read. Try again.");
  CC_SHA256_CTX context; CC_SHA256_Init(&context);
  unsigned char buffer[65536], digest[CC_SHA256_DIGEST_LENGTH]; ssize_t count;
  while ((count = read(fd, buffer, sizeof(buffer))) > 0) CC_SHA256_Update(&context, buffer, (CC_LONG)count);
  close(fd); Require(count == 0, "The downloaded update could not be read. Try again.");
  CC_SHA256_Final(digest, &context);
  NSMutableString *result = [NSMutableString new]; for (auto byte : digest) [result appendFormat:@"%02x", byte]; return result;
}
void GPVerifyUpdateArchive(NSString *archive, NSString *sha256) {
  Require([sha256 isKindOfClass:NSString.class] && sha256.length == 64 && [sha256 rangeOfCharacterFromSet:[[NSCharacterSet characterSetWithCharactersInString:@"0123456789abcdefABCDEF"] invertedSet]].location == NSNotFound,
    "GitHub did not provide a valid checksum for this update.");
  struct stat status{};
  Require(lstat(archive.fileSystemRepresentation, &status) == 0 && S_ISREG(status.st_mode) && status.st_size > 0 && status.st_size <= 512LL*1024*1024,
    "The downloaded update has an invalid size. Try again.");
  Require([GPUpdateSHA256(archive) isEqual:sha256.lowercaseString], "The update checksum did not match. Check your connection and try again.");
}

namespace {
struct Descriptor { int value; explicit Descriptor(int fd):value(fd) {} ~Descriptor(){ if(value>=0) close(value); } };
struct Tar {
  gzFile file; explicit Tar(NSString *path):file(gzopen(path.fileSystemRepresentation,"rb")) { Require(file,"The update archive could not be opened."); }
  ~Tar(){ gzclose(file); }
  void read(void *buffer, size_t length) { auto *out=(unsigned char *)buffer; while(length) { int n=gzread(file,out,(unsigned)std::min(length,size_t(65536))); Require(n>0,"The update archive is incomplete or damaged."); out+=n; length-=n; } }
  void padding(uint64_t size) { unsigned char bytes[512]; if(size%512) read(bytes,512-size%512); }
  void finish() {
    // Consume gzip's checksum/trailer and bounded tar padding; do not accept a
    // concatenated archive hidden after the first end marker.
    unsigned char bytes[65536]; size_t padding=0; int count;
    while((count=gzread(file,bytes,sizeof(bytes)))>0) {
      padding+=count;
      Require(padding<=1024*1024 && std::all_of(bytes,bytes+count,[](unsigned char c){return c==0;}),"The update archive has unexpected trailing data.");
    }
    int error=0; gzerror(file,&error);
    Require(count==0 && error==Z_OK && gzeof(file),"The update archive is incomplete or damaged.");
  }
};
uint64_t Octal(char const *value, size_t length) {
  uint64_t number=0; bool ended=false;
  for(size_t i=0;i<length;i++) { unsigned char c=value[i]; if(c==0 || c==' ') { if(number) ended=true; continue; }
    Require(!ended && c>='0' && c<='7' && number < (1ULL<<56),"The update archive contains an invalid size."); number=number*8+c-'0'; }
  return number;
}
NSString *TarString(char const *value,size_t length) { size_t n=strnlen(value,length); NSString *s=[[NSString alloc] initWithBytes:value length:n encoding:NSUTF8StringEncoding]; Require(s,"The update archive contains an invalid filename."); return s; }
NSArray<NSString *> *Components(NSString *path) {
  Require(path.length && !path.isAbsolutePath && ![path containsString:@"\\"] && [path rangeOfCharacterFromSet:NSCharacterSet.controlCharacterSet].location==NSNotFound,"The update archive contains an unsafe path.");
  NSMutableArray *parts=[NSMutableArray new]; for(NSString *part in [path componentsSeparatedByString:@"/"]) {
    if(!part.length) continue; Require(![part isEqual:@"."] && ![part isEqual:@".."],"The update archive contains an unsafe path."); [parts addObject:part];
  } Require(parts.count>0 && parts.count<100,"The update archive path is too long."); return parts;
}
int ParentFD(int root,NSArray<NSString *> *parts) {
  int fd=dup(root); Require(fd>=0,"Could not open the update folder.");
  for(NSUInteger i=0;i+1<parts.count;i++) {
    auto name=parts[i].fileSystemRepresentation;
    if(mkdirat(fd,name,0755)!=0 && errno!=EEXIST) { close(fd); throw std::runtime_error("Could not unpack the update. Check available space."); }
    int next=openat(fd,name,O_RDONLY|O_DIRECTORY|O_NOFOLLOW); close(fd); Require(next>=0,"The update archive contains an unsafe folder."); fd=next;
  } return fd;
}
std::map<std::string,std::string> Pax(std::string const& data) {
  std::map<std::string,std::string> values; size_t position=0;
  while(position<data.size()) {
    auto space=data.find(' ',position); Require(space!=std::string::npos && space-position<=8,"The update archive metadata is invalid.");
    uint64_t length=0; for(size_t i=position;i<space;i++){ Require(data[i]>='0'&&data[i]<='9',"The update archive metadata is invalid."); length=length*10+data[i]-'0'; }
    Require(length>space-position+2 && length<=data.size()-position && data[position+length-1]=='\n',"The update archive metadata is invalid.");
    auto entry=data.substr(space+1,position+length-space-2); auto equals=entry.find('='); Require(equals!=std::string::npos,"The update archive metadata is invalid.");
    auto key=entry.substr(0,equals); Require(key.rfind("GNU.sparse",0)!=0,"Sparse update archives are not supported.");
    if(key=="path" || key=="linkpath" || key=="size") { Require(!values.count(key),"The update archive metadata is ambiguous."); values[key]=entry.substr(equals+1); }
    position+=length;
  } return values;
}
}
void GPExtractUpdateArchive(NSString *archive, NSString *directory) {
  Require(![NSFileManager.defaultManager fileExistsAtPath:directory],"The update staging folder already exists. Check for updates again.");
  GPCreatePrivateDirectory(directory); Descriptor root(open(directory.fileSystemRepresentation,O_RDONLY|O_DIRECTORY|O_NOFOLLOW)); Require(root.value>=0,"Could not open the update folder.");
  Tar input(archive); uint64_t total=0; size_t entries=0; std::set<std::string> names; std::map<std::string,std::string> pax;
  NSMutableArray<NSDictionary *> *links=[NSMutableArray new];
  while(true) {
    char header[512]; input.read(header,sizeof(header));
    if(std::all_of(header,header+512,[](char c){return c==0;})) {
      char second[512]; input.read(second,512); Require(pax.empty() && std::all_of(second,second+512,[](char c){return c==0;}),"The update archive ending is invalid."); input.finish(); break;
    }
    Require(++entries<=30000,"The update archive contains too many files.");
    uint64_t sum=0; for(size_t i=0;i<512;i++) sum+=(i>=148&&i<156)?' ':(unsigned char)header[i];
    Require(sum==Octal(header+148,8),"The update archive is damaged.");
    Require(memcmp(header+257,"ustar",5)==0 && (header[262]==0 || header[262]==' '),"The update archive format is unsupported.");
    uint64_t size=Octal(header+124,12); char type=header[156];
    if(type=='x') { Require(pax.empty() && size<=256*1024,"The update archive metadata is too large."); std::string text(size,'\0'); input.read(text.data(),size); input.padding(size); pax=Pax(text); continue; }
    Require(type=='0' || type==0 || type=='5' || type=='2',"The update archive contains unsupported links or file types.");
    NSString *name=TarString(header,100), *prefix=TarString(header+345,155), *target=TarString(header+157,100);
    if(prefix.length) name=Join(prefix,name);
    if(pax.count("path")) name=[[NSString alloc] initWithBytes:pax["path"].data() length:pax["path"].size() encoding:NSUTF8StringEncoding];
    if(pax.count("linkpath")) target=[[NSString alloc] initWithBytes:pax["linkpath"].data() length:pax["linkpath"].size() encoding:NSUTF8StringEncoding];
    if(pax.count("size")) { Require(!pax["size"].empty(),"The update archive size is invalid."); size=0; for(char c:pax["size"]) { Require(c>='0'&&c<='9'&&size<=2ULL*1024*1024*1024,"The update archive size is invalid."); size=size*10+c-'0'; } }
    pax.clear(); Require(name && target,"The update archive contains an invalid filename.");
    auto parts=Components(name); name=[parts componentsJoinedByString:@"/"];
    Require(names.insert(name.precomposedStringWithCanonicalMapping.lowercaseString.UTF8String).second,"The update archive contains duplicate paths.");
    Require(gamepack::updates::acceptArchiveBytes(total,size),"The unpacked update is too large.");
    bool app=[parts[0] isEqual:@"GamePack.app"];
    // Older published packages put license notices beside the app. They may be
    // read and discarded, but never provide links or executable update logic.
    bool legacyNotices=[parts[0] isEqual:@"Notices"] && (type=='0'||type==0||type=='5');
    Require(app || legacyNotices || (([name isEqual:@"README.txt"] || [name isEqual:@"Install.command"]) && (type=='0'||type==0)),"The update archive contains unexpected files.");
    Require(type!='5' || size==0,"The update archive contains an invalid folder.");
    if(type=='2') {
      Require(app && size==0 && target.length && !target.isAbsolutePath && ![target containsString:@"\\"] && [target rangeOfCharacterFromSet:NSCharacterSet.controlCharacterSet].location==NSNotFound,"The update archive contains an unsafe link.");
      NSString *resolved=[Join(name.stringByDeletingLastPathComponent,target) stringByStandardizingPath];
      Require([resolved hasPrefix:@"GamePack.app/"],"The update archive contains a link outside the app.");
      [links addObject:@{@"path":name,@"target":target}]; continue;
    }
    Descriptor parent(app?ParentFD(root.value,parts):-1); Descriptor output(-1);
    if(app && type=='5') { Require(size==0 && (mkdirat(parent.value,[parts.lastObject fileSystemRepresentation],0755)==0 || errno==EEXIST),"Could not create an update folder."); }
    if(app && (type=='0'||type==0)) { output.value=openat(parent.value,[parts.lastObject fileSystemRepresentation],O_WRONLY|O_CREAT|O_EXCL|O_NOFOLLOW,0600); Require(output.value>=0,"Could not unpack the update. Check available space."); }
    char buffer[65536]; uint64_t remaining=size;
    while(remaining) { auto n=(size_t)std::min(remaining,uint64_t(sizeof(buffer))); input.read(buffer,n); if(output.value>=0) { size_t written=0; while(written<n) { ssize_t count=write(output.value,buffer+written,n-written); Require(count>0,"Could not unpack the update. Check available space."); written+=count; } } remaining-=n; }
    input.padding(size);
    if(output.value>=0) Require(fchmod(output.value,(Octal(header+100,8)&0111)?0755:0644)==0,"Could not set update file permissions.");
  }
  // No archive-controlled links exist while regular files are being written.
  for(NSDictionary *link in links) { auto parts=Components(link[@"path"]); Descriptor parent(ParentFD(root.value,parts)); Require(symlinkat([link[@"target"] fileSystemRepresentation],parent.value,[parts.lastObject fileSystemRepresentation])==0,"The update archive contains a conflicting link."); }
  NSString *app=Join(directory,@"GamePack.app");
  for(NSDictionary *link in links) { NSString *path=Join(directory,link[@"path"]); char resolved[PATH_MAX]; Require(realpath(path.fileSystemRepresentation,resolved)!=nullptr && Inside([NSString stringWithUTF8String:resolved],app),"The update archive contains an unsafe or broken link."); }
  Require([NSFileManager.defaultManager fileExistsAtPath:Join(app,@"Contents/Info.plist")],"The update archive does not contain GamePack.");
}

static NSDictionary *SigningInformation(NSString *app) {
  SecStaticCodeRef code=nullptr;
  Require(SecStaticCodeCreateWithPath((__bridge CFURLRef)[NSURL fileURLWithPath:app],kSecCSDefaultFlags,&code)==errSecSuccess,"The update has no valid app signature.");
  OSStatus status=SecStaticCodeCheckValidity(code,kSecCSStrictValidate|kSecCSCheckAllArchitectures|kSecCSCheckNestedCode,nullptr);
  CFDictionaryRef info=nullptr;
  if(status==errSecSuccess) status=SecCodeCopySigningInformation(code,kSecCSSigningInformation,&info);
  CFRelease(code); Require(status==errSecSuccess && info,"The update’s app signature is invalid. Check for updates again.");
  return CFBridgingRelease(info);
}
void GPValidateUpdateApp(NSString *app, NSString *version, NSString *architecture, NSString *currentApp) {
  NSBundle *bundle=[NSBundle bundleWithPath:app]; NSDictionary *info=[NSDictionary dictionaryWithContentsOfFile:Join(app,@"Contents/Info.plist")];
  Require([info[@"CFBundleIdentifier"] isEqual:@"app.gamepack.desktop"] && [info[@"CFBundleExecutable"] isEqual:@"GamePack"] && [info[@"CFBundleShortVersionString"] isEqual:version],"The downloaded app does not match this release.");
  cpu_type_t cpu=[architecture isEqual:@"arm64"]?CPU_TYPE_ARM64:CPU_TYPE_X86_64;
  Require(([architecture isEqual:@"arm64"]||[architecture isEqual:@"x64"]) && bundle.executableArchitectures.count==1 && [bundle.executableArchitectures.firstObject intValue]==cpu,"The update is for a different Mac architecture.");
  NSDictionary *signature=SigningInformation(app);
  if(currentApp) { NSDictionary *current=SigningInformation(currentApp); NSString *team=current[(__bridge NSString *)kSecCodeInfoTeamIdentifier]; if(team.length) Require([signature[(__bridge NSString *)kSecCodeInfoTeamIdentifier] isEqual:team],"The update is signed by a different developer."); }
}
void GPQuarantineUpdate(NSString *app, NSString *sourceURL) {
  NSDictionary *properties=@{(__bridge NSString *)kLSQuarantineAgentNameKey:@"GamePack",(__bridge NSString *)kLSQuarantineTypeKey:(__bridge NSString *)kLSQuarantineTypeWebDownload,
    (__bridge NSString *)kLSQuarantineDataURLKey:[NSURL URLWithString:sourceURL],(__bridge NSString *)kLSQuarantineOriginURLKey:[NSURL URLWithString:@"https://github.com/Potirniche-Carmine/GamePack/releases"]};
  Require([[NSURL fileURLWithPath:app] setResourceValue:properties forKey:NSURLQuarantinePropertiesKey error:nil],"Could not apply macOS download verification to the update.");
}
NSDictionary *GPUpdateProcessIdentity(pid_t pid) {
  struct proc_bsdinfo info{}; char path[PROC_PIDPATHINFO_MAXSIZE];
  Require(pid>0 && proc_pidinfo(pid,PROC_PIDTBSDINFO,0,&info,sizeof(info))==sizeof(info) && info.pbi_uid==getuid() && proc_pidpath(pid,path,sizeof(path))>0,"Could not identify the running GamePack process.");
  return @{@"pid":@(pid),@"seconds":@(info.pbi_start_tvsec),@"microseconds":@(info.pbi_start_tvusec),@"path":[NSString stringWithUTF8String:path]};
}
bool GPUpdateProcessMatches(pid_t pid,NSDictionary *identity) { try { return [identity isKindOfClass:NSDictionary.class] && [GPUpdateProcessIdentity(pid) isEqual:identity]; } catch(...) { return false; } }

static NSRunningApplication *Launch(NSString *app,NSString *root,bool &uncertain) {
  NSWorkspaceOpenConfiguration *config=[NSWorkspaceOpenConfiguration configuration]; config.environment=@{@"GAMEPACK_HOME":root}; config.activates=YES;
  __block NSRunningApplication *running=nil; dispatch_semaphore_t signal=dispatch_semaphore_create(0);
  [NSWorkspace.sharedWorkspace openApplicationAtURL:[NSURL fileURLWithPath:app] configuration:config completionHandler:^(NSRunningApplication *value,NSError *error) { running=value; dispatch_semaphore_signal(signal); }];
  if(dispatch_semaphore_wait(signal,dispatch_time(DISPATCH_TIME_NOW,30*NSEC_PER_SEC))!=0) { uncertain=true; return nil; }
  return running;
}
int GPRunUpdateInstallJob(NSString *jobPath) {
  NSString *root=nil,*destination=nil,*backup=nil,*staged=nil,*statePath=nil; bool movedOld=false,movedNew=false,started=false;
  Descriptor operation(-1);
  try {
    NSDictionary *job=GPReadUpdatePlist(jobPath); root=job[@"root"]; destination=job[@"destination"]; staged=job[@"staged"];
    Require([root isKindOfClass:NSString.class]&&[destination isKindOfClass:NSString.class]&&[staged isKindOfClass:NSString.class],"The update installation request is invalid.");
    GPRequireManagedInstallation(root,destination); NSString *directory=jobPath.stringByDeletingLastPathComponent;
    Require([Canonical(directory) isEqual:directory] && Inside(directory,Join(root,@"updates")) && [jobPath isEqual:Join(directory,@"job.plist")] && [staged isEqual:Join(directory,@"payload/GamePack.app")],"The update staging location is invalid.");
    operation.value=open(Join(root,@"updates/operation.lock").fileSystemRepresentation,O_CREAT|O_RDWR|O_NOFOLLOW,0600);
    Require(operation.value>=0 && flock(operation.value,LOCK_EX|LOCK_NB)==0,"Another GamePack window is updating. Try again after it finishes.");
    statePath=Join(root,@"updates/state.plist"); backup=Join(directory,@"previous.app");
    NSString *version=GPUpdateVersion(job[@"version"]),*architecture=GPUpdateArchitecture();
    NSString *oldVersion=[NSDictionary dictionaryWithContentsOfFile:Join(destination,@"Contents/Info.plist")][@"CFBundleShortVersionString"];
    Require(gamepack::updates::newerStableVersion(version.UTF8String,oldVersion.UTF8String?:""),"The update is not newer than the installed app.");
    GPValidateUpdateApp(staged,version,architecture,destination);
    NSDictionary *process=job[@"process"];
    Require([process isKindOfClass:NSDictionary.class] && [process[@"pid"] isKindOfClass:NSNumber.class],"The running GamePack process changed. Check for updates again.");
    pid_t pid=[process[@"pid"] intValue];
    Require([process[@"path"] isEqual:Join(destination,@"Contents/MacOS/GamePack")] && GPUpdateProcessMatches(pid,process),"The running GamePack process changed. Check for updates again.");
    for(NSRunningApplication *app in [NSRunningApplication runningApplicationsWithBundleIdentifier:@"app.gamepack.desktop"])
      Require(app.processIdentifier==pid || ![Canonical(app.bundleURL.path) isEqual:destination],"Another GamePack window is still open. Close it and try again.");
    Require(![NSFileManager.defaultManager fileExistsAtPath:backup],"A previous update is still pending. Restart GamePack and try again.");
    NSDictionary *helper=GPUpdateProcessIdentity(getpid());
    GPWriteUpdatePlist(@{@"ready":@YES,@"process":helper},Join(directory,@"helper-ready.plist"));
    // Parent exit alone is not installation permission: its request may have
    // timed out or failed after spawning this helper. Require an explicit
    // commit bound to both process identities before observing a graceful quit.
    NSString *permitPath=Join(directory,@"install-permitted.plist");
    auto permissionDeadline=NSDate.timeIntervalSinceReferenceDate+30;
    NSDictionary *permission=nil;
    while(GPUpdateProcessMatches(pid,process) && NSDate.timeIntervalSinceReferenceDate<permissionDeadline) {
      permission=GPReadUpdatePlist(permitPath);
      if(permission) break;
      usleep(50000);
    }
    permission=GPReadUpdatePlist(permitPath);
    Require([permission[@"helper"] isEqual:helper] && [permission[@"parent"] isEqual:process],"The update restart was cancelled. Check for updates and try again.");
    auto deadline=NSDate.timeIntervalSinceReferenceDate+120;
    while(GPUpdateProcessMatches(pid,process) && NSDate.timeIntervalSinceReferenceDate<deadline) usleep(100000);
    Require(!GPUpdateProcessMatches(pid,process),"GamePack did not quit. Close it, then try the update again.");
    // Refuse replacement if a second instance opened this installation meanwhile.
    for(NSRunningApplication *app in [NSRunningApplication runningApplicationsWithBundleIdentifier:@"app.gamepack.desktop"])
      Require(![Canonical(app.bundleURL.path) isEqual:destination],"Another GamePack window is still open. Close it and try again.");
    GPRequireManagedInstallation(root,destination);
    oldVersion=[NSDictionary dictionaryWithContentsOfFile:Join(destination,@"Contents/Info.plist")][@"CFBundleShortVersionString"];
    Require([oldVersion isKindOfClass:NSString.class] && gamepack::updates::newerStableVersion(version.UTF8String,oldVersion.UTF8String),"The installed app changed while this update was prepared. Check for updates again.");
    GPValidateUpdateApp(staged,version,architecture,destination);
    Move(destination,backup); movedOld=true; Move(staged,destination); movedNew=true;
    NSRunningApplication *app=Launch(destination,root,started);
    Require(app!=nil,"macOS could not open the update. Approve GamePack in Privacy & Security if requested, then try again."); started=true;
    GPWriteUpdatePlist(@{@"status":@"idle",@"version":version},statePath);
    // Do not roll back after new code ran: a future update could migrate data.
    NSDate *until=[NSDate dateWithTimeIntervalSinceNow:10]; while(!app.terminated && until.timeIntervalSinceNow>0) usleep(100000);
    Require(!app.terminated,"The updated app closed unexpectedly. The previous app was kept in the update folder; your library was not changed by the updater.");
    [NSFileManager.defaultManager removeItemAtPath:directory error:nil];
    return 0;
  } catch(std::exception const& error) {
    NSString *message=[NSString stringWithUTF8String:error.what()];
    if(movedOld && !started) {
      if(movedNew) [NSFileManager.defaultManager moveItemAtPath:destination toPath:staged error:nil];
      BOOL restored=[NSFileManager.defaultManager moveItemAtPath:backup toPath:destination error:nil];
      if(restored) { bool uncertain=false; Launch(destination,root,uncertain); }
      else message=@"The update could not finish or restore the previous app. Your previous app is in the update folder. Reinstall GamePack to continue; the updater has not changed your library.";
    }
    if(statePath) { try { GPWriteUpdatePlist(@{@"status":@"error",@"error":message},statePath); } catch(...) {} }
    return 1;
  }
}
