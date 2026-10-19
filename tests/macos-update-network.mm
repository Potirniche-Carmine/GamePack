// Compile the actual private downloader/parser implementation into a separate
// test executable. No test URL, server, or bypass is available in the app.
#import "../native/macos/GPUpdater.mm"
#include <cassert>
#pragma clang diagnostic ignored "-Wnonnull" // Unused delegate parameters in direct callback tests.

int main() { @autoreleasepool {
  unsigned checks=0;
  auto redirect=[&](NSString *url,BOOL metadata,bool allowed) {
    GPUpdateDownload *download=[GPUpdateDownload new]; download.metadata=metadata;
    __block BOOL accepted=NO;
    [download URLSession:nil task:nil willPerformHTTPRedirection:nil newRequest:[NSURLRequest requestWithURL:[NSURL URLWithString:url]] completionHandler:^(NSURLRequest *request){accepted=request!=nil;}];
    assert(accepted==allowed); checks++;
  };
  for(NSString *host in @[@"github.com",@"release-assets.githubusercontent.com",@"objects.githubusercontent.com",@"github-releases.githubusercontent.com"])
    redirect([@"https://" stringByAppendingString:[host stringByAppendingString:@"/asset"]],NO,true);
  for(NSString *url in @[@"http://github.com/asset",@"https://github.com.evil.example/asset",@"https://evil.example/github.com",@"https://user@github.com/asset",@"https://github.com:444/asset",@"file:///tmp/asset"])
    redirect(url,NO,false);
  redirect(@"https://api.github.com/repos/release",YES,true);
  redirect(@"https://github.com/repos/release",YES,false);
  GPUpdateDownload *download=[GPUpdateDownload new]; download.limit=10;
  for(int n=0;n<6;n++) {
    __block BOOL allowed=NO;
    [download URLSession:nil task:nil willPerformHTTPRedirection:nil newRequest:[NSURLRequest requestWithURL:[NSURL URLWithString:@"https://github.com/asset"]] completionHandler:^(NSURLRequest *request){allowed=request!=nil;}];
    assert(allowed==(n<5)); checks++;
  }
  for(NSNumber *status in @[@200,@403,@404,@429,@500]) {
    GPUpdateDownload *value=[GPUpdateDownload new]; value.limit=10;
    NSHTTPURLResponse *response=[[NSHTTPURLResponse alloc] initWithURL:[NSURL URLWithString:@"https://github.com/asset"] statusCode:status.integerValue HTTPVersion:@"HTTP/1.1" headerFields:@{@"Content-Length":@"10"}];
    __block NSURLSessionResponseDisposition action;
    [value URLSession:nil dataTask:nil didReceiveResponse:response completionHandler:^(NSURLSessionResponseDisposition result){action=result;}];
    assert((action==NSURLSessionResponseAllow)==(status.intValue==200));
    if(status.intValue==403 || status.intValue==429) assert([value.failure.localizedDescription containsString:@"limit"]);
    if(status.intValue==404) assert([value.failure.localizedDescription containsString:@"no longer available"]);
    checks++;
  }
  NSHTTPURLResponse *large=[[NSHTTPURLResponse alloc] initWithURL:[NSURL URLWithString:@"https://github.com/asset"] statusCode:200 HTTPVersion:@"HTTP/1.1" headerFields:@{@"Content-Length":@"11"}];
  __block NSURLSessionResponseDisposition disposition;
  [download URLSession:nil dataTask:nil didReceiveResponse:large completionHandler:^(NSURLSessionResponseDisposition result){disposition=result;}];
  assert(disposition==NSURLSessionResponseCancel); checks++;
  download=[GPUpdateDownload new]; download.limit=1;
  [download URLSession:nil dataTask:nil didReceiveData:[@"oversized" dataUsingEncoding:NSUTF8StringEncoding]];
  assert(download.failure.code==2); checks++;
  NSString *name=@"GamePack-macos-arm64.tar.gz";
  NSDictionary *asset=@{@"name":name,@"state":@"uploaded",@"size":@10};
  assert([Asset(@{@"assets":@[asset]},name) isEqual:asset]); checks++;
  for(id assets in @[[NSNull null],@[],@[asset,asset],@[@{@"name":name,@"state":@"new",@"size":@10}],@[@{@"name":name,@"state":@"uploaded",@"size":@-1}],@[@{@"name":name,@"state":@"uploaded",@"size":@"10"}]]) {
    bool rejected=false; try { Asset(@{@"assets":assets},name); } catch(std::exception const&) { rejected=true; }
    assert(rejected); checks++;
  }
  printf("macOS download boundary validation passed (%u checks)\n",checks);
}}
