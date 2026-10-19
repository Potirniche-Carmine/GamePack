#import "GPUpdateSupport.h"
int main(int argc,char **argv) {
  @autoreleasepool {
    if(argc!=2) return 64;
    return GPRunUpdateInstallJob([NSString stringWithUTF8String:argv[1]]);
  }
}
