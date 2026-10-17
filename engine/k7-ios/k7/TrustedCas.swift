// TrustedCas.swift — the CAs the user tells this app to trust, beyond the set it ships: a studio behind a
// private CA is refused otherwise, and the supervisor's TLS stack cannot read what a user installed in
// Settings. Kept as one PEM file the supervisor is handed as STUDIO_EXTRA_CA_CERTS; the views ask it too,
// through iOS's own trust evaluation, so iOS's TLS rules still apply. See engine/k7-runtime/docs/ios.md.

import Foundation
import Security

enum TrustedCas {
    /// The PEM file, whether or not it exists yet.
    static var file: URL { EngineBridge.stateDir.appendingPathComponent("trusted-cas.pem") }

    /// How many certificates are trusted beyond the shipped set.
    static func count() -> Int { read().count }

    /// Add every certificate in the file — PEM or DER, one or a bundle — and name what was added; throws on anything else.
    static func importFile(_ url: URL) throws -> [String] {
        let scoped = url.startAccessingSecurityScopedResource()
        defer { if scoped { url.stopAccessingSecurityScopedResource() } }
        let parsed = parse(try Data(contentsOf: url))
        if parsed.isEmpty {
            throw NSError(domain: "k7", code: 2, userInfo: [NSLocalizedDescriptionKey: "no certificate in that file"])
        }
        let kept = read()
        let keptDer = Set(kept.map { SecCertificateCopyData($0) as Data })
        let added = parsed.filter { !keptDer.contains(SecCertificateCopyData($0) as Data) }
        write(kept + added)
        return added.map { (SecCertificateCopySubjectSummary($0) as String?) ?? "a certificate" }
    }

    /// Trust the shipped set only again.
    static func forget() {
        try? FileManager.default.removeItem(at: file)
    }

    /// Whether the imported certificates vouch for a server iOS refused: a CA as an anchor, a non-CA only as that very leaf.
    static func vouch(_ trust: SecTrust, host: String) -> Bool {
        let imported = read()
        guard !imported.isEmpty,
              let chain = SecTrustCopyCertificateChain(trust) as? [SecCertificate],
              let leaf = chain.first else { return false }
        let leafDer = SecCertificateCopyData(leaf) as Data
        var anchors = imported.filter { CertTrust.isCa(SecCertificateCopyData($0) as Data) }
        if imported.contains(where: { SecCertificateCopyData($0) as Data == leafDer }) { anchors.append(leaf) }
        guard !anchors.isEmpty else { return false }
        // A wrong name, a date out of range or a broken chain still fails here: only the anchors change.
        SecTrustSetPolicies(trust, SecPolicyCreateSSL(true, host as CFString))
        SecTrustSetAnchorCertificates(trust, anchors as CFArray)
        SecTrustSetAnchorCertificatesOnly(trust, false)
        return SecTrustEvaluateWithError(trust, nil)
    }

    private static func read() -> [SecCertificate] {
        guard let data = try? Data(contentsOf: file) else { return [] }
        return parse(data)
    }

    /// PEM blocks when the text has any, else the whole file as one DER certificate.
    private static func parse(_ data: Data) -> [SecCertificate] {
        let text = String(decoding: data, as: UTF8.self)
        let begin = "-----BEGIN CERTIFICATE-----", end = "-----END CERTIFICATE-----"
        var out: [SecCertificate] = []
        var rest = text[...]
        while let b = rest.range(of: begin), let e = rest.range(of: end, range: b.upperBound..<rest.endIndex) {
            let body = rest[b.upperBound..<e.lowerBound].filter { !$0.isWhitespace }
            if let der = Data(base64Encoded: String(body)), let cert = SecCertificateCreateWithData(nil, der as CFData) {
                out.append(cert)
            }
            rest = rest[e.upperBound...]
        }
        if out.isEmpty, let cert = SecCertificateCreateWithData(nil, data as CFData) { out.append(cert) }
        return out
    }

    // PEM, whatever came in: the supervisor appends this file's text to the roots it gives mbedTLS.
    private static func write(_ certs: [SecCertificate]) {
        let pem = certs.map { cert -> String in
            let b64 = (SecCertificateCopyData(cert) as Data).base64EncodedString(options: [.lineLength64Characters, .endLineWithLineFeed])
            return "-----BEGIN CERTIFICATE-----\n\(b64)\n-----END CERTIFICATE-----\n"
        }.joined()
        try? pem.write(to: file, atomically: true, encoding: .utf8)
    }
}
