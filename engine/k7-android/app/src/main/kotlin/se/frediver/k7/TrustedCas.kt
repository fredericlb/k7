// TrustedCas.kt — the CAs the user tells this app to trust, beyond Android's own: a studio behind a
// private CA is refused otherwise, and an app cannot read the certificates a user installed in Settings.
// Kept as one PEM file the supervisor is handed as STUDIO_EXTRA_CA_CERTS. See docs/android.md.

package se.frediver.k7

import android.content.Context
import android.net.Uri
import android.net.http.SslError
import android.util.Base64
import java.io.File
import java.security.cert.CertificateFactory
import java.security.cert.X509Certificate

object TrustedCas {
    /** The PEM file, whether or not it exists yet. */
    fun file(context: Context) = File(EngineBridge.stateDir(context), "trusted-cas.pem")

    /** How many certificates are trusted beyond Android's. */
    fun count(context: Context): Int = read(context).size

    /** Add every certificate in the document — PEM or DER, one or a bundle — and name what was added; throws on anything else. */
    fun import(context: Context, uri: Uri): List<String> {
        val parsed = context.contentResolver.openInputStream(uri).use { input ->
            requireNotNull(input) { "the file could not be opened" }
            CertificateFactory.getInstance("X.509").generateCertificates(input).filterIsInstance<X509Certificate>()
        }
        require(parsed.isNotEmpty()) { "no certificate in that file" }
        val kept = read(context)
        val added = parsed.filter { cert -> kept.none { it.encoded.contentEquals(cert.encoded) } }
        write(context, kept + added)
        return added.map { it.subjectX500Principal.name }
    }

    /** Trust Android's CAs only again. */
    fun forget(context: Context) {
        file(context).delete()
    }

    /** Whether the imported certificates vouch for a page the WebView refused for its unknown issuer ALONE (CertTrust's rules). */
    fun vouch(context: Context, error: SslError): Boolean {
        val faults = listOf(
            SslError.SSL_NOTYETVALID, SslError.SSL_EXPIRED, SslError.SSL_IDMISMATCH,
            SslError.SSL_UNTRUSTED, SslError.SSL_DATE_INVALID, SslError.SSL_INVALID,
        ).filter(error::hasError)
        // A wrong name, a date out of range or a broken chain is never ours to forgive, whoever signed it.
        if (faults != listOf(SslError.SSL_UNTRUSTED)) return false
        val leaf = error.certificate.x509Certificate ?: return false
        val host = Uri.parse(error.url).host ?: return false
        return CertTrust.vouches(leaf, host, read(context))
    }

    private fun read(context: Context): List<X509Certificate> {
        val f = file(context)
        if (!f.isFile) return emptyList()
        return f.inputStream().use {
            CertificateFactory.getInstance("X.509").generateCertificates(it).filterIsInstance<X509Certificate>()
        }
    }

    // PEM, whatever came in: the supervisor appends this file's text to the roots it gives mbedTLS.
    private fun write(context: Context, certs: List<X509Certificate>) {
        val f = file(context)
        f.parentFile?.mkdirs()
        f.writeText(certs.joinToString("") { cert ->
            "-----BEGIN CERTIFICATE-----\n" +
                Base64.encodeToString(cert.encoded, Base64.NO_WRAP).chunked(64).joinToString("\n") +
                "\n-----END CERTIFICATE-----\n"
        })
    }
}
