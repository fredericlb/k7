// CertTrustTest.kt — CertTrust's decision over fixed certificates (test resources `certs/`, valid until 2126):
// `ca` a CA, `leaf` its leaf for studio.example, *.wild.example and 192.168.1.10, `self` a self-signed
// non-CA for self.example, and `child` a leaf `self` signed, which must never pass.

package se.frediver.k7

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.security.cert.CertificateFactory
import java.security.cert.X509Certificate
import java.util.Calendar
import java.util.Date
import java.util.TimeZone

class CertTrustTest {
    private fun cert(name: String): X509Certificate =
        javaClass.classLoader!!.getResourceAsStream("certs/$name.pem").use {
            CertificateFactory.getInstance("X.509").generateCertificate(it) as X509Certificate
        }

    private val ca = cert("ca")
    private val leaf = cert("leaf")
    private val self = cert("self")
    private val child = cert("child")

    private fun year(y: Int): Date =
        Calendar.getInstance(TimeZone.getTimeZone("UTC")).apply { clear(); set(y, 0, 1) }.time

    @Test
    fun aCaVouchesForItsLeafOnANameTheLeafCarries() {
        assertTrue(CertTrust.vouches(leaf, "studio.example", listOf(ca)))
        assertTrue(CertTrust.vouches(leaf, "STUDIO.example.", listOf(ca)))
        assertTrue(CertTrust.vouches(leaf, "a.wild.example", listOf(ca)))
        assertTrue(CertTrust.vouches(leaf, "192.168.1.10", listOf(ca)))
    }

    @Test
    fun aNameTheLeafDoesNotCarryIsRefused() {
        assertFalse(CertTrust.vouches(leaf, "evil.example", listOf(ca)))
        assertFalse(CertTrust.vouches(leaf, "wild.example", listOf(ca)))
        assertFalse(CertTrust.vouches(leaf, "a.b.wild.example", listOf(ca)))
        assertFalse(CertTrust.vouches(leaf, "192.168.1.11", listOf(ca)))
        assertFalse(CertTrust.vouches(leaf, "leaf", listOf(ca)))
    }

    @Test
    fun aLeafOutOfItsDatesIsRefused() {
        assertFalse(CertTrust.vouches(leaf, "studio.example", listOf(ca), year(2000)))
        assertFalse(CertTrust.vouches(leaf, "studio.example", listOf(ca), year(2200)))
    }

    @Test
    fun anImportedNonCaIsTrustedAsThatExactLeafOnly() {
        assertTrue(CertTrust.vouches(self, "self.example", listOf(self)))
        assertFalse(CertTrust.vouches(self, "other.example", listOf(self)))
        assertFalse(CertTrust.vouches(child, "evil.example", listOf(self)))
    }

    @Test
    fun nothingImportedVouchesForNothing() {
        assertFalse(CertTrust.vouches(leaf, "studio.example", emptyList()))
        assertFalse(CertTrust.vouches(leaf, "studio.example", listOf(self)))
    }

    @Test
    fun onlyACaCountsAsOne() {
        assertTrue(CertTrust.isCa(ca))
        assertFalse(CertTrust.isCa(self))
        assertFalse(CertTrust.isCa(leaf))
    }
}
