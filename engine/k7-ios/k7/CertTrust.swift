// CertTrust.swift — whether a certificate may issue others, read from its DER: iOS has no public API for a
// certificate's extensions. TrustedCas keeps Android's rule with it: an imported CA signs for any host its
// leaves name, an imported NON-CA is trusted as that exact certificate only. See engine/k7-runtime/docs/ios.md.

import Foundation

enum CertTrust {
    /// basicConstraints CA:true and, when a key usage is stated, keyCertSign; false for anything it cannot read.
    static func isCa(_ der: Data) -> Bool {
        guard let ext = extensions(Array(der)) else { return false }
        guard let bc = ext[basicConstraints], caFlag(bc) else { return false }
        guard let ku = ext[keyUsage] else { return true }
        return keyCertSign(ku)
    }

    private static let basicConstraints: [UInt8] = [0x55, 0x1D, 0x13]
    private static let keyUsage: [UInt8] = [0x55, 0x1D, 0x0F]

    /// One TLV at `at`: its tag, where its content starts, and its length.
    private static func tlv(_ b: [UInt8], _ at: Int) -> (tag: UInt8, start: Int, length: Int)? {
        guard at + 1 < b.count else { return nil }
        var len = Int(b[at + 1])
        var start = at + 2
        if len & 0x80 != 0 {
            let n = len & 0x7F
            guard n > 0, n <= 4, start + n <= b.count else { return nil }
            len = b[start..<start + n].reduce(0) { $0 << 8 | Int($1) }
            start += n
        }
        guard start + len <= b.count else { return nil }
        return (b[at], start, len)
    }

    /// The children of the constructed value whose content spans `start..<start+length`.
    private static func children(_ b: [UInt8], _ start: Int, _ length: Int) -> [(tag: UInt8, start: Int, length: Int)] {
        var out: [(tag: UInt8, start: Int, length: Int)] = []
        var at = start
        while at < start + length, let t = tlv(b, at) {
            out.append(t)
            at = t.start + t.length
        }
        return out
    }

    /// extnID → extnValue's content, from tbsCertificate's `[3]` extensions; nil when the certificate does not parse.
    private static func extensions(_ b: [UInt8]) -> [[UInt8]: [UInt8]]? {
        guard let cert = tlv(b, 0), cert.tag == 0x30,
              let tbs = children(b, cert.start, cert.length).first, tbs.tag == 0x30 else { return nil }
        var out: [[UInt8]: [UInt8]] = [:]
        guard let wrapped = children(b, tbs.start, tbs.length).first(where: { $0.tag == 0xA3 }),
              let list = children(b, wrapped.start, wrapped.length).first, list.tag == 0x30 else { return out }
        for ext in children(b, list.start, list.length) where ext.tag == 0x30 {
            let parts = children(b, ext.start, ext.length)
            guard let oid = parts.first, oid.tag == 0x06, let value = parts.last, value.tag == 0x04 else { continue }
            out[Array(b[oid.start..<oid.start + oid.length])] = Array(b[value.start..<value.start + value.length])
        }
        return out
    }

    // BasicConstraints ::= SEQUENCE { cA BOOLEAN DEFAULT FALSE, pathLenConstraint INTEGER OPTIONAL }.
    private static func caFlag(_ v: [UInt8]) -> Bool {
        guard let seq = tlv(v, 0), seq.tag == 0x30, let first = children(v, seq.start, seq.length).first else { return false }
        return first.tag == 0x01 && first.length == 1 && v[first.start] != 0
    }

    // KeyUsage ::= BIT STRING, keyCertSign being bit 5 of the first byte after the unused-bits count.
    private static func keyCertSign(_ v: [UInt8]) -> Bool {
        guard let bits = tlv(v, 0), bits.tag == 0x03, bits.length >= 2 else { return false }
        return v[bits.start + 1] & 0x04 != 0
    }
}
