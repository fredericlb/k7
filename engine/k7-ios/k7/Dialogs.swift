// Dialogs.swift — the few things the app says natively, over whatever is on screen: a yes-or-no a page can neither
// draw nor click, which is what keeps a script from listing the engine at a studio of its own, and a short notice
// that fades, iOS having no toast. See engine/k7-runtime/docs/ios.md.

import UIKit

enum Dialogs {
    private static var asking = false

    /// The controller on top, which is the one a dialog must be presented from.
    static func top() -> UIViewController? {
        let scene = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first
        var at = scene?.windows.first(where: \.isKeyWindow)?.rootViewController
        while let next = at?.presentedViewController { at = next }
        return at
    }

    /// The user's yes, on the main thread; a dismissal or a second question while one is up is a no.
    static func confirm(_ title: String, _ message: String, yes: String, no: String = "Cancel", _ answer: @escaping (Bool) -> Void) {
        DispatchQueue.main.async {
            guard !asking, let top = top() else { return answer(false) }
            asking = true
            let alert = UIAlertController(title: title, message: message, preferredStyle: .alert)
            alert.addAction(UIAlertAction(title: no, style: .cancel) { _ in
                asking = false
                answer(false)
            })
            alert.addAction(UIAlertAction(title: yes, style: .default) { _ in
                asking = false
                answer(true)
            })
            top.present(alert, animated: true)
        }
    }

    /// A yes or no waited for on this thread, which must not be the main one.
    static func ask(_ title: String, _ message: String, yes: String, no: String) -> Bool {
        let done = DispatchSemaphore(value: 0)
        var said = false
        confirm(title, message, yes: yes, no: no) {
            said = $0
            done.signal()
        }
        done.wait()
        return said
    }

    /// A notice with one OK, for what the user must read before going on.
    static func inform(_ title: String, _ message: String) {
        DispatchQueue.main.async {
            let alert = UIAlertController(title: title, message: message, preferredStyle: .alert)
            alert.addAction(UIAlertAction(title: "OK", style: .default))
            top()?.present(alert, animated: true)
        }
    }

    /// A few seconds of text at the bottom of the screen, whatever is in front.
    static func tell(_ said: String) {
        DispatchQueue.main.async {
            guard let window = top()?.view.window else { return }
            let label = PaddedLabel()
            label.text = said
            label.numberOfLines = 0
            label.textColor = .white
            label.backgroundColor = UIColor(white: 0.15, alpha: 0.95)
            label.font = .preferredFont(forTextStyle: .subheadline)
            label.layer.cornerRadius = 10
            label.clipsToBounds = true
            label.translatesAutoresizingMaskIntoConstraints = false
            window.addSubview(label)
            NSLayoutConstraint.activate([
                label.leadingAnchor.constraint(greaterThanOrEqualTo: window.safeAreaLayoutGuide.leadingAnchor, constant: 16),
                label.trailingAnchor.constraint(lessThanOrEqualTo: window.safeAreaLayoutGuide.trailingAnchor, constant: -16),
                label.centerXAnchor.constraint(equalTo: window.centerXAnchor),
                label.bottomAnchor.constraint(equalTo: window.safeAreaLayoutGuide.bottomAnchor, constant: -24),
            ])
            UIView.animate(withDuration: 0.3, delay: 4, options: []) { label.alpha = 0 } completion: { _ in
                label.removeFromSuperview()
            }
        }
    }
}

private final class PaddedLabel: UILabel {
    override func drawText(in rect: CGRect) {
        super.drawText(in: rect.insetBy(dx: 14, dy: 10))
    }

    override var intrinsicContentSize: CGSize {
        let size = super.intrinsicContentSize
        return CGSize(width: size.width + 28, height: size.height + 20)
    }
}
