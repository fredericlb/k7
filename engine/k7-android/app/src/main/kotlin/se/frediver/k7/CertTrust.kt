// CertTrust.kt — whether the certificates the user imported (TrustedCas) vouch for a page's leaf, as a
// pure function of the leaf, the host, the imported list and the time, so a JVM test can drive it.
// An imported CA signs for any host its leaves name; an imported NON-CA is trusted as that exact leaf only.
// See docs/android.md (the private CA).

package se.frediver.k7

import java.net.InetAddress
import java.security.MessageDigest
import java.security.cert.X509Certificate
import java.util.Date

object CertTrust {
    private const val SAN_DNS = 2
    private const val SAN_IP = 7
    private const val KEY_CERT_SIGN = 5

    /** Whether `trusted` vouches for `leaf` serving `host` at `now`; every other fault is the WebView's to refuse. */
    fun vouches(leaf: X509Certificate, host: String, trusted: List<X509Certificate>, now: Date = Date()): Boolean {
        if (!validAt(leaf, now) || !hostMatches(leaf, host)) return false
        val digest = sha256(leaf)
        return trusted.any { ca ->
            sha256(ca).contentEquals(digest) || (isCa(ca) && validAt(ca, now) && signed(leaf, ca))
        }
    }

    /** Whether `cert` may issue others: basicConstraints CA:true and, when key usage is stated, keyCertSign. */
    fun isCa(cert: X509Certificate): Boolean =
        cert.basicConstraints >= 0 && (cert.keyUsage?.getOrNull(KEY_CERT_SIGN) ?: true)

    /** RFC 6125 against the subjectAltName only: a dNSName, one leftmost `*` label at most, or an iPAddress for an IP host. */
    fun hostMatches(leaf: X509Certificate, host: String): Boolean {
        val h = host.removePrefix("[").removeSuffix("]").trimEnd('.').lowercase()
        if (h.isEmpty()) return false
        val names = runCatching { leaf.subjectAlternativeNames }.getOrNull() ?: return false
        if (isIpLiteral(h)) {
            val want = runCatching { InetAddress.getByName(h) }.getOrNull() ?: return false
            return names.any { it.size >= 2 && it[0] == SAN_IP && ipEquals(it[1] as? String, want) }
        }
        return names.any { it.size >= 2 && it[0] == SAN_DNS && dnsMatches(it[1] as? String, h) }
    }

    private fun dnsMatches(pattern: String?, host: String): Boolean {
        val p = pattern?.trimEnd('.')?.lowercase() ?: return false
        if (p.isEmpty()) return false
        if (!p.startsWith("*.")) return !p.contains('*') && p == host
        val suffix = p.substring(1)
        // `*.com` names a whole TLD, and `*` anywhere else is a partial wildcard: neither is honoured.
        if (suffix.substring(1).count { it == '.' } < 1 || suffix.contains('*')) return false
        if (!host.endsWith(suffix)) return false
        val label = host.substring(0, host.length - suffix.length)
        return label.isNotEmpty() && !label.contains('.')
    }

    private fun isIpLiteral(h: String) = h.contains(':') || Regex("""\d{1,3}(\.\d{1,3}){3}""").matches(h)

    private fun ipEquals(san: String?, want: InetAddress): Boolean {
        if (san == null || !isIpLiteral(san.lowercase())) return false
        return runCatching { InetAddress.getByName(san) == want }.getOrDefault(false)
    }

    private fun validAt(cert: X509Certificate, now: Date) = runCatching { cert.checkValidity(now) }.isSuccess

    private fun signed(leaf: X509Certificate, ca: X509Certificate) =
        ca.subjectX500Principal == leaf.issuerX500Principal && runCatching { leaf.verify(ca.publicKey) }.isSuccess

    private fun sha256(cert: X509Certificate): ByteArray = MessageDigest.getInstance("SHA-256").digest(cert.encoded)
}
