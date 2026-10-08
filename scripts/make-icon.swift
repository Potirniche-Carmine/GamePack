import AppKit
let output = CommandLine.arguments[1]
let image = NSImage(size: NSSize(width:1024,height:1024))
image.lockFocus()
NSColor(calibratedRed:0.10,green:0.11,blue:0.13,alpha:1).setFill()
NSBezierPath(roundedRect:NSRect(x:30,y:30,width:964,height:964),xRadius:210,yRadius:210).fill()
NSColor(calibratedRed:0.95,green:0.96,blue:0.97,alpha:1).setStroke()
let frame=NSBezierPath(roundedRect:NSRect(x:199,y:252,width:626,height:520),xRadius:88,yRadius:88)
frame.lineWidth=38;frame.stroke()
let play=NSBezierPath();play.move(to:NSPoint(x:427,y:382));play.line(to:NSPoint(x:635,y:512));play.line(to:NSPoint(x:427,y:642));play.close()
NSColor.white.setFill();play.fill()
NSColor(calibratedRed:0.47,green:0.76,blue:0.98,alpha:1).setStroke()
let mark=NSBezierPath();mark.move(to:NSPoint(x:610,y:263));mark.curve(to:NSPoint(x:857,y:391),controlPoint1:NSPoint(x:697,y:205),controlPoint2:NSPoint(x:815,y:264));mark.lineWidth=45;mark.lineCapStyle = .round;mark.stroke()
image.unlockFocus()
let source=NSBitmapImageRep(data:image.tiffRepresentation!)!
let sizes=[16,32,64,128,256,512,1024]
try FileManager.default.createDirectory(atPath:output,withIntermediateDirectories:true)
for size in sizes {
 let bitmap=NSBitmapImageRep(bitmapDataPlanes:nil,pixelsWide:size,pixelsHigh:size,bitsPerSample:8,samplesPerPixel:4,hasAlpha:true,isPlanar:false,colorSpaceName:.deviceRGB,bytesPerRow:0,bitsPerPixel:0)!
 NSGraphicsContext.saveGraphicsState();NSGraphicsContext.current=NSGraphicsContext(bitmapImageRep:bitmap)
 NSGraphicsContext.current?.imageInterpolation = .high
 NSImage(cgImage:source.cgImage!,size:NSSize(width:1024,height:1024)).draw(in:NSRect(x:0,y:0,width:size,height:size))
 NSGraphicsContext.restoreGraphicsState()
 try bitmap.representation(using:.png,properties:[:])!.write(to:URL(fileURLWithPath:"\(output)/icon-\(size).png"))
}
let specs=[(16,1),(16,2),(32,1),(32,2),(128,1),(128,2),(256,1),(256,2),(512,1),(512,2)]
let entries=specs.map{["idiom":"mac","size":"\($0.0)x\($0.0)","scale":"\($0.1)x","filename":"icon-\($0.0*$0.1).png"]}
let json=try JSONSerialization.data(withJSONObject:["images":entries,"info":["version":1,"author":"GamePack"]],options:[.prettyPrinted,.sortedKeys])
try json.write(to:URL(fileURLWithPath:"\(output)/Contents.json"))

if CommandLine.arguments.count > 2 {
 let windowsOutput = CommandLine.arguments[2]
 try FileManager.default.createDirectory(atPath:windowsOutput,withIntermediateDirectories:true)
 let windowsImages: [(String, Int, Int)] = [
  ("Square44x44Logo.targetsize-24_altform-unplated.png",24,24),
  ("Square44x44Logo.scale-200.png",88,88),
  ("Square150x150Logo.scale-200.png",300,300),
  ("Wide310x150Logo.scale-200.png",620,300),
  ("LockScreenLogo.scale-200.png",48,48),
  ("SplashScreen.scale-200.png",1240,600),
  ("StoreLogo.png",50,50),
 ]
 for (filename,width,height) in windowsImages {
  let bitmap=NSBitmapImageRep(bitmapDataPlanes:nil,pixelsWide:width,pixelsHigh:height,bitsPerSample:8,samplesPerPixel:4,hasAlpha:true,isPlanar:false,colorSpaceName:.deviceRGB,bytesPerRow:0,bitsPerPixel:0)!
  NSGraphicsContext.saveGraphicsState();NSGraphicsContext.current=NSGraphicsContext(bitmapImageRep:bitmap)
  NSGraphicsContext.current?.imageInterpolation = .high
  let side=min(width,height)
  NSImage(cgImage:source.cgImage!,size:NSSize(width:1024,height:1024)).draw(in:NSRect(x:(width-side)/2,y:(height-side)/2,width:side,height:side))
  NSGraphicsContext.restoreGraphicsState()
  try bitmap.representation(using:.png,properties:[:])!.write(to:URL(fileURLWithPath:"\(windowsOutput)/\(filename)"))
 }
}
