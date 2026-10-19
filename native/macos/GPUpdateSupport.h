#pragma once
#import <Foundation/Foundation.h>

// Shared production validation used by the app, trusted helper, and offline tests.
// Failures throw std::runtime_error with an actionable user-facing message.
NSString *GPUpdateArchitecture(void);
NSString *GPUpdateRoot(void);
NSString *GPCanonicalUpdatePath(NSString *path);
NSString *GPUpdateVersion(NSString *tag);
void GPRequireManagedInstallation(NSString *root, NSString *app);
NSString *GPManagedUpdateApp(NSString *root, NSString *runningApp);
void GPCreatePrivateDirectory(NSString *path);
void GPWriteUpdatePlist(NSDictionary *value, NSString *path);
NSDictionary *GPReadUpdatePlist(NSString *path);
NSString *GPUpdateSHA256(NSString *path);
void GPVerifyUpdateArchive(NSString *archive, NSString *sha256);
void GPExtractUpdateArchive(NSString *archive, NSString *directory);
void GPValidateUpdateApp(NSString *app, NSString *version, NSString *architecture, NSString *currentApp);
void GPQuarantineUpdate(NSString *app, NSString *sourceURL);
NSDictionary *GPUpdateProcessIdentity(pid_t pid);
bool GPUpdateProcessMatches(pid_t pid, NSDictionary *identity);
int GPRunUpdateInstallJob(NSString *jobPath);
