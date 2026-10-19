#import <Foundation/Foundation.h>
@interface GPUpdater : NSObject
+ (instancetype)shared;
- (void)prepare:(NSString *)tag;
- (NSDictionary *)state;
- (void)install;
@end
