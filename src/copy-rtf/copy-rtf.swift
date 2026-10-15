import AppKit

// Publish all representations on one item: Electron apps often prefer HTML to RTF.
let html = try Data(contentsOf: URL(fileURLWithPath: CommandLine.arguments[1]))
let attributed = try NSAttributedString(
    data: html,
    options: [.documentType: NSAttributedString.DocumentType.html,
              .characterEncoding: String.Encoding.utf8.rawValue],
    documentAttributes: nil
)
let rtf = try attributed.data(
    from: NSRange(location: 0, length: attributed.length),
    documentAttributes: [.documentType: NSAttributedString.DocumentType.rtf]
)
let item = NSPasteboardItem()
guard item.setData(rtf, forType: .rtf),
      item.setData(html, forType: .html),
      item.setString(attributed.string, forType: .string) else {
    fatalError("Could not prepare rich-text clipboard item")
}

let pasteboard = NSPasteboard.general
pasteboard.clearContents()
guard pasteboard.writeObjects([item]) else {
    fatalError("Could not write to the macOS clipboard")
}
