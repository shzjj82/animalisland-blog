// 按 macOS 图标模板排版：1024 画布，居中 824 圆角方块 + 投影，四周留透明边
// 用法: swift scripts/app-icon.swift <源图> <输出.png>
import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers

let args = CommandLine.arguments
guard args.count == 3,
      let source = CGImageSourceCreateWithURL(URL(fileURLWithPath: args[1]) as CFURL, nil),
      let logo = CGImageSourceCreateImageAtIndex(source, 0, nil)
else {
  FileHandle.standardError.write("用法: swift scripts/app-icon.swift <源图> <输出.png>\n".data(using: .utf8)!)
  exit(1)
}

/// 源图是 JPEG，白底带压缩噪点；接近白色的像素统一成纯白，免得在圆角方块里露出方框
func cleaned(_ image: CGImage) -> CGImage {
  let width = image.width
  let height = image.height
  guard let ctx = CGContext(
    data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: width * 4,
    space: CGColorSpace(name: CGColorSpace.sRGB)!,
    bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
  ), let data = ctx.data else { return image }
  ctx.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))
  let pixels = data.bindMemory(to: UInt8.self, capacity: width * height * 4)
  for i in stride(from: 0, to: width * height * 4, by: 4) {
    if pixels[i] >= 225 && pixels[i + 1] >= 225 && pixels[i + 2] >= 225 {
      pixels[i] = 255
      pixels[i + 1] = 255
      pixels[i + 2] = 255
    }
  }
  return ctx.makeImage() ?? image
}

let size = 1024
let tile = CGRect(x: 100, y: 100, width: 824, height: 824)
let radius: CGFloat = 185
let glyph: CGFloat = 740

guard let ctx = CGContext(
  data: nil, width: size, height: size, bitsPerComponent: 8, bytesPerRow: 0,
  space: CGColorSpace(name: CGColorSpace.sRGB)!,
  bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
) else { exit(1) }

let path = CGPath(roundedRect: tile, cornerWidth: radius, cornerHeight: radius, transform: nil)

ctx.saveGState()
ctx.setShadow(offset: CGSize(width: 0, height: -10), blur: 24, color: CGColor(gray: 0, alpha: 0.28))
ctx.addPath(path)
ctx.setFillColor(CGColor(gray: 1, alpha: 1))
ctx.fillPath()
ctx.restoreGState()

ctx.saveGState()
ctx.addPath(path)
ctx.clip()
let inset = (CGFloat(size) - glyph) / 2
ctx.interpolationQuality = .high
ctx.draw(cleaned(logo), in: CGRect(x: inset, y: inset, width: glyph, height: glyph))
ctx.restoreGState()

guard let image = ctx.makeImage(),
      let dest = CGImageDestinationCreateWithURL(URL(fileURLWithPath: args[2]) as CFURL, UTType.png.identifier as CFString, 1, nil)
else { exit(1) }
CGImageDestinationAddImage(dest, image, nil)
exit(CGImageDestinationFinalize(dest) ? 0 : 1)
