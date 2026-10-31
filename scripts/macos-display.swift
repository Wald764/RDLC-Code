// Enlarge the main macOS display so the 1440x900 Desktop workbench fits.
//
// GitHub macos-15 runners start at 1024x768. This script uses CoreGraphics only
// (Swift ships with Xcode), so nothing has to be installed. Run it as
// `swift scripts/macos-display.swift`. It prints the current and every
// available display mode, then applies the best-fitting one: the smallest mode
// of at least 1440x900 points, else the largest usable mode, preferring 1x
// pixel density on a tie. It always exits 0: when no larger mode exists, the
// Desktop driver reports the clear window-geometry failure.

import CoreGraphics
import Foundation

let wantedWidth = 1440
let wantedHeight = 900

func describe(_ mode: CGDisplayMode) -> String {
  let usable = mode.isUsableForDesktopGUI()
  return "\(mode.width)x\(mode.height) pixels=\(mode.pixelWidth)x\(mode.pixelHeight) "
    + "refresh=\(mode.refreshRate)Hz usable=\(usable)"
}

func describe(bounds: CGRect) -> String {
  return "origin=(\(Int(bounds.origin.x)),\(Int(bounds.origin.y))) "
    + "size=\(Int(bounds.size.width))x\(Int(bounds.size.height))"
}

func area(_ mode: CGDisplayMode) -> Int {
  return mode.width * mode.height
}

/// True when `candidate` should replace `best` as the chosen mode.
func isBetter(_ candidate: CGDisplayMode, than best: CGDisplayMode) -> Bool {
  let candidateFits = candidate.width >= wantedWidth && candidate.height >= wantedHeight
  let bestFits = best.width >= wantedWidth && best.height >= wantedHeight
  if candidateFits != bestFits { return candidateFits }
  if area(candidate) != area(best) {
    // Smallest mode that fits, otherwise the largest mode available.
    return candidateFits ? area(candidate) < area(best) : area(candidate) > area(best)
  }
  let candidateIsOneX = candidate.pixelWidth == candidate.width
  let bestIsOneX = best.pixelWidth == best.width
  if candidateIsOneX != bestIsOneX { return candidateIsOneX }
  return candidate.refreshRate > best.refreshRate
}

let display = CGMainDisplayID()
print("main display id: \(display)")
print("bounds before: \(describe(bounds: CGDisplayBounds(display)))")

guard let current = CGDisplayCopyDisplayMode(display) else {
  print("no current display mode is available; leaving the display unchanged")
  exit(0)
}
print("current mode: \(describe(current))")

let options = [kCGDisplayShowDuplicateLowResolutionModes as String: true] as CFDictionary
guard let modes = CGDisplayCopyAllDisplayModes(display, options) as? [CGDisplayMode] else {
  print("the display modes cannot be listed; leaving the display unchanged")
  exit(0)
}

print("available modes: \(modes.count)")
for mode in modes {
  print("  \(describe(mode))")
}

let usableModes = modes.filter { $0.isUsableForDesktopGUI() }
guard var best = usableModes.first else {
  print("no usable display mode; leaving the display unchanged")
  exit(0)
}
for mode in usableModes.dropFirst() where isBetter(mode, than: best) {
  best = mode
}
print("chosen mode: \(describe(best))")

if best.width == current.width && best.height == current.height
  && best.pixelWidth == current.pixelWidth
{
  print("the current mode is already the best fit; nothing to change")
} else {
  var config: CGDisplayConfigRef?
  var failure = CGBeginDisplayConfiguration(&config)
  if failure == .success {
    failure = CGConfigureDisplayWithDisplayMode(config, display, best, nil)
    if failure == .success {
      failure = CGCompleteDisplayConfiguration(config, .permanently)
    } else {
      _ = CGCancelDisplayConfiguration(config)
    }
  }
  if failure == .success {
    // Give the window server a moment to apply the new mode.
    Thread.sleep(forTimeInterval: 2)
  } else {
    print("the display mode change failed with CGError \(failure.rawValue)")
  }
}

print("bounds after: \(describe(bounds: CGDisplayBounds(display)))")
exit(0)
