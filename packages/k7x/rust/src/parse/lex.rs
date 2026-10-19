// lex.rs — the token half of parse.rs: whitespace and comments, words, numbers and the three string forms.
// A reader would get wrong that it walks chars: every token of the grammar is ASCII, so it walks bytes and copies string runs whole.

use super::{Parser, Res, SyntaxError};
use bumpalo::collections::String as BumpString;

const BOM: &[u8] = "\u{feff}".as_bytes();

const fn ident_head(c: u8) -> bool {
    c.is_ascii_alphabetic() || c == b'_' || c == b'$'
}

const fn ident_tail(c: u8) -> bool {
    c.is_ascii_alphanumeric() || c == b'_' || c == b'$' || c == b'-'
}

impl<'a> Parser<'a> {
    #[inline]
    pub(super) fn at(&self, i: usize) -> u8 {
        self.b.get(i).copied().unwrap_or(0)
    }

    #[inline]
    pub(super) fn cur(&self) -> u8 {
        self.at(self.pos)
    }

    #[cold]
    pub(super) fn fail<T>(&self, message: impl Into<String>, at: usize) -> Res<T> {
        let before = &self.src[..at];
        let line = before.bytes().filter(|&c| c == b'\n').count() + 1;
        let line_start = before.rfind('\n').map_or(0, |i| i + 1);
        let column = before[line_start..].encode_utf16().count() + 1;
        Err(SyntaxError {
            message: message.into(),
            offset: at,
            line,
            column,
        })
    }

    /// Skips whitespace and both comment forms.
    pub(super) fn skip(&mut self) -> Res<()> {
        loop {
            match self.cur() {
                b' ' | b'\t' | b'\n' | b'\r' => self.pos += 1,
                0xEF if self.b[self.pos..].starts_with(BOM) => self.pos += BOM.len(),
                b'/' if self.at(self.pos + 1) == b'/' => {
                    self.pos = self.b[self.pos..]
                        .iter()
                        .position(|&c| c == b'\n')
                        .map_or(self.b.len(), |i| self.pos + i);
                }
                b'/' if self.at(self.pos + 1) == b'*' => {
                    match self.src[self.pos + 2..].find("*/") {
                        Some(i) => self.pos += 2 + i + 2,
                        None => return self.fail("unterminated comment", self.pos),
                    }
                }
                _ => return Ok(()),
            }
        }
    }

    /// Whether the next significant character is `c`, without moving.
    pub(super) fn next_is(&mut self, c: u8) -> Res<bool> {
        let at = self.pos;
        self.skip()?;
        let next = self.cur();
        self.pos = at;
        Ok(next == c)
    }

    pub(super) fn ident(&self, at: usize) -> Option<usize> {
        if !ident_head(self.at(at)) {
            return None;
        }
        let mut end = at + 1;
        while ident_tail(self.at(end)) {
            end += 1;
        }
        Some(end)
    }

    /// The end of `-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?` at `at`, matched as the sticky regex would.
    pub(super) fn number(&self, at: usize) -> Option<usize> {
        let digits = |mut i: usize| {
            while self.at(i).is_ascii_digit() {
                i += 1;
            }
            i
        };
        let mut i = at + usize::from(self.at(at) == b'-');
        i = match self.at(i) {
            b'0' => i + 1,
            b'1'..=b'9' => digits(i + 1),
            _ => return None,
        };
        if self.at(i) == b'.' && self.at(i + 1).is_ascii_digit() {
            i = digits(i + 1);
        }
        if matches!(self.at(i), b'e' | b'E') {
            let sign = usize::from(matches!(self.at(i + 1), b'+' | b'-'));
            if self.at(i + 1 + sign).is_ascii_digit() {
                i = digits(i + 1 + sign);
            }
        }
        Some(i)
    }

    /// A "…" or '…' string, with JSON's escapes plus \'; borrowed from the text when it has no escape.
    pub(super) fn quoted(&mut self) -> Res<&'a str> {
        let quote = self.cur();
        let mut end = self.pos + 1;
        while !matches!(self.at(end), b'\\' | b'\n' | 0) && self.at(end) != quote {
            end += 1;
        }
        if self.at(end) == quote {
            let s = &self.src[self.pos + 1..end];
            self.pos = end + 1;
            return Ok(s);
        }
        self.quoted_decoded()
    }

    fn quoted_decoded(&mut self) -> Res<&'a str> {
        let quote = self.cur();
        let start = self.pos;
        self.pos += 1;
        let mut out = BumpString::new_in(self.bump);
        loop {
            let run = self.pos;
            while !matches!(self.cur(), b'\\' | b'\n' | 0) && self.cur() != quote {
                self.pos += 1;
            }
            out.push_str(&self.src[run..self.pos]);
            let c = self.cur();
            if c == 0 && self.pos >= self.b.len() || c == b'\n' {
                return self.fail("unterminated string", start);
            }
            self.pos += 1;
            if c == quote {
                return Ok(out.into_bump_str());
            }
            if c == 0 {
                out.push('\0');
                continue;
            }
            let e = self.cur();
            self.pos += 1;
            match e {
                b'u' => {
                    let unit = self.hex4(self.pos)?;
                    self.pos += 4;
                    out.push(self.code_point(unit));
                }
                b'n' => out.push('\n'),
                b't' => out.push('\t'),
                b'r' => out.push('\r'),
                b'b' => out.push('\u{8}'),
                b'f' => out.push('\u{c}'),
                b'0' => out.push('\0'),
                b'\\' | b'/' | b'"' | b'\'' => out.push(e as char),
                _ => {
                    let shown = self.src.get(self.pos - 1..).and_then(|s| s.chars().next());
                    let shown = shown.map_or("undefined".to_owned(), String::from);
                    return self.fail(format!("unknown escape \\{shown}"), self.pos - 2);
                }
            }
        }
    }

    fn hex4(&self, at: usize) -> Res<u16> {
        let hex = self
            .b
            .get(at..at + 4)
            .filter(|h| h.iter().all(u8::is_ascii_hexdigit));
        match hex {
            Some(h) => Ok(u16::from_str_radix(std::str::from_utf8(h).unwrap(), 16).unwrap()),
            None => self.fail("bad \\u escape", at - 2),
        }
    }

    /// A \u unit as a char: a surrogate pair joins, and a lone surrogate, which a Rust string cannot hold, is U+FFFD.
    fn code_point(&mut self, unit: u16) -> char {
        if (0xD800..0xDC00).contains(&unit)
            && self.b[self.pos..].starts_with(b"\\u")
            && let Ok(low @ 0xDC00..=0xDFFF) = self.hex4(self.pos + 2)
        {
            self.pos += 6;
            let cp = 0x10000 + ((u32::from(unit) - 0xD800) << 10) + (u32::from(low) - 0xDC00);
            return char::from_u32(cp).unwrap_or('\u{FFFD}');
        }
        char::from_u32(u32::from(unit)).unwrap_or_else(|| {
            self.lossy = true;
            '\u{FFFD}'
        })
    }

    /// A `…` string: raw, multi-line, only \` and \\ escaped, and never interpolated.
    pub(super) fn raw(&mut self) -> Res<&'a str> {
        if let Some(i) = self.b[self.pos + 1..]
            .iter()
            .position(|&c| c == b'`' || c == b'\\')
            && self.b[self.pos + 1 + i] == b'`'
        {
            let s = &self.src[self.pos + 1..self.pos + 1 + i];
            self.pos += i + 2;
            return Ok(s);
        }
        self.raw_decoded()
    }

    fn raw_decoded(&mut self) -> Res<&'a str> {
        let start = self.pos;
        self.pos += 1;
        let mut out = BumpString::new_in(self.bump);
        loop {
            let run = self.pos;
            while !matches!(self.cur(), b'`' | b'\\') && self.pos < self.b.len() {
                self.pos += 1;
            }
            out.push_str(&self.src[run..self.pos]);
            if self.pos >= self.b.len() {
                return self.fail("unterminated string", start);
            }
            let c = self.cur();
            self.pos += 1;
            if c == b'`' {
                return Ok(out.into_bump_str());
            }
            let n = self.cur();
            if n == b'`' || n == b'\\' {
                out.push(n as char);
                self.pos += 1;
            } else {
                out.push('\\');
            }
        }
    }
}
