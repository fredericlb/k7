// parse.rs — k7x text → the span-carrying tree of ast.rs, decision for decision the parser of ../src/parse.ts.
// A reader would get wrong that it walks chars: every token of the grammar is ASCII, so it walks bytes and copies string runs whole.

use crate::ast::{Entry, ListForm, MapForm, MapNode, Node, Scalar};
use std::borrow::Cow;
use std::collections::HashSet;
use std::fmt;

/// How deep values may nest: far past any real file, and short of the stack a hostile one would exhaust.
pub const MAX_DEPTH: usize = 256;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SyntaxError {
    pub message: String,
    pub offset: usize,
    pub line: usize,
    /// Counted in UTF-16 units, as the TypeScript parser counts it.
    pub column: usize,
}

impl fmt::Display for SyntaxError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{} ({}:{})", self.message, self.line, self.column)
    }
}

impl std::error::Error for SyntaxError {}

type Res<T> = Result<T, SyntaxError>;

const BOM: &[u8] = "\u{feff}".as_bytes();

struct Parser<'a> {
    src: &'a str,
    b: &'a [u8],
    pos: usize,
    depth: usize,
    /// Children being collected, shared by every open container so each gets one exact-size allocation.
    nodes: Vec<Node<'a>>,
    entries: Vec<Entry<'a>>,
}

const fn ident_head(c: u8) -> bool {
    c.is_ascii_alphabetic() || c == b'_' || c == b'$'
}

const fn ident_tail(c: u8) -> bool {
    c.is_ascii_alphanumeric() || c == b'_' || c == b'$' || c == b'-'
}

impl<'a> Parser<'a> {
    fn new(src: &'a str) -> Self {
        Parser {
            src,
            b: src.as_bytes(),
            pos: 0,
            depth: 0,
            nodes: Vec::new(),
            entries: Vec::new(),
        }
    }

    #[inline]
    fn at(&self, i: usize) -> u8 {
        self.b.get(i).copied().unwrap_or(0)
    }

    #[inline]
    fn cur(&self) -> u8 {
        self.at(self.pos)
    }

    #[cold]
    fn fail<T>(&self, message: impl Into<String>, at: usize) -> Res<T> {
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
    fn skip(&mut self) -> Res<()> {
        loop {
            match self.cur() {
                b' ' | b'\t' | b'\n' | b'\r' => self.pos += 1,
                0xEF if self.b[self.pos..].starts_with(BOM) => self.pos += BOM.len(),
                b'/' if self.at(self.pos + 1) == b'/' => {
                    self.pos =
                        memchr(b'\n', &self.b[self.pos..]).map_or(self.b.len(), |i| self.pos + i);
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
    fn next_is(&mut self, c: u8) -> Res<bool> {
        let at = self.pos;
        self.skip()?;
        let next = self.cur();
        self.pos = at;
        Ok(next == c)
    }

    fn root(&mut self) -> Res<MapNode<'a>> {
        let mut entries = Vec::new();
        let mut groups = Vec::new();
        self.skip()?;
        while self.pos < self.b.len() {
            if self.cur() == b';' {
                self.pos += 1;
                self.skip()?;
                continue;
            }
            let first = entries.len();
            entries.extend(self.chain()?.entries);
            groups.push((first, entries.len()));
            self.skip()?;
        }
        self.check_unique(&entries)?;
        Ok(MapNode {
            entries,
            form: MapForm::Root,
            groups,
            start: 0,
            end: self.b.len(),
        })
    }

    fn chain(&mut self) -> Res<MapNode<'a>> {
        let start = self.pos;
        let mark = self.entries.len();
        let head = self.call(None)?;
        self.entries.push(head);
        while self.next_is(b'.')? {
            self.skip()?;
            let dot = self.pos;
            self.pos += 1;
            self.skip()?;
            let e = self.call(Some(dot))?;
            self.entries.push(e);
        }
        let entries: Vec<_> = self.entries.drain(mark..).collect();
        self.check_unique(&entries)?;
        let end = entries[entries.len() - 1].end;
        Ok(MapNode {
            entries,
            form: MapForm::Chain,
            groups: Vec::new(),
            start,
            end,
        })
    }

    fn call(&mut self, dot: Option<usize>) -> Res<Entry<'a>> {
        let key_start = self.pos;
        let key = self.key()?;
        self.skip()?;
        if self.cur() != b'(' {
            return self.fail(format!("expected \"(\" after {key}"), self.pos);
        }
        self.pos += 1;
        let open = self.pos;
        let mark = self.nodes.len();
        self.skip()?;
        while self.cur() != b')' {
            let v = self.value()?;
            self.nodes.push(v);
            self.skip()?;
            match self.cur() {
                b',' => {
                    self.pos += 1;
                    self.skip()?;
                }
                b')' => {}
                _ => return self.fail("expected \",\" or \")\"", self.pos),
            }
        }
        let close = self.pos;
        self.pos += 1;
        let value = match self.nodes.len() - mark {
            0 => Node::Scalar {
                value: Scalar::Bool(true),
                start: open,
                end: open,
            },
            1 => self.nodes.pop().unwrap(),
            _ => {
                let args: Vec<_> = self.nodes.drain(mark..).collect();
                let (start, end) = (args[0].start(), args[args.len() - 1].end());
                Node::List {
                    items: args,
                    form: ListForm::Args,
                    start,
                    end,
                }
            }
        };
        Ok(Entry {
            key,
            value,
            start: dot.unwrap_or(key_start),
            end: close + 1,
            dot,
            key_start,
        })
    }

    fn ident(&self, at: usize) -> Option<usize> {
        if !ident_head(self.at(at)) {
            return None;
        }
        let mut end = at + 1;
        while ident_tail(self.at(end)) {
            end += 1;
        }
        Some(end)
    }

    fn key(&mut self) -> Res<Cow<'a, str>> {
        let c = self.cur();
        if c == b'"' || c == b'\'' {
            return self.quoted();
        }
        match self.ident(self.pos) {
            Some(end) => {
                let k = Cow::Borrowed(&self.src[self.pos..end]);
                self.pos = end;
                Ok(k)
            }
            None => self.fail("expected a key", self.pos),
        }
    }

    fn value(&mut self) -> Res<Node<'a>> {
        if self.depth >= MAX_DEPTH {
            return self.fail(format!("nested deeper than {MAX_DEPTH}"), self.pos);
        }
        self.depth += 1;
        let v = self.value_at();
        self.depth -= 1;
        v
    }

    fn value_at(&mut self) -> Res<Node<'a>> {
        let start = self.pos;
        let c = self.cur();
        match c {
            b'[' => return self.list(),
            b'{' => return self.object().map(Node::Map),
            b'`' => {
                let s = self.raw()?;
                return Ok(self.scalar(Scalar::Str(s), start));
            }
            b'"' | b'\'' => {
                let s = self.quoted()?;
                if !self.next_is(b'(')? {
                    return Ok(self.scalar(Scalar::Str(s), start));
                }
                self.pos = start;
                return self.chain().map(Node::Map);
            }
            b'-' | b'0'..=b'9' => {
                let Some(end) = self.number(start) else {
                    return self.fail("malformed number", self.pos);
                };
                self.pos = end;
                let n: f64 = self.src[start..end].parse().unwrap_or(f64::NAN);
                return Ok(self.scalar(Scalar::Num(n), start));
            }
            _ => {}
        }
        let Some(end) = self.ident(start) else {
            return self.fail("expected a value", self.pos);
        };
        self.pos = end;
        if self.next_is(b'(')? {
            self.pos = start;
            return self.chain().map(Node::Map);
        }
        let value = match &self.src[start..end] {
            "true" => Scalar::Bool(true),
            "false" => Scalar::Bool(false),
            "null" => Scalar::Null,
            w => {
                return self.fail(
                    format!("bare word \"{w}\": quote a string, or call it as {w}(…)"),
                    start,
                );
            }
        };
        Ok(self.scalar(value, start))
    }

    /// The end of `-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?` at `at`, matched as the sticky regex would.
    fn number(&self, at: usize) -> Option<usize> {
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

    #[inline]
    fn scalar(&self, value: Scalar<'a>, start: usize) -> Node<'a> {
        Node::Scalar {
            value,
            start,
            end: self.pos,
        }
    }

    fn list(&mut self) -> Res<Node<'a>> {
        let start = self.pos;
        self.pos += 1;
        let mark = self.nodes.len();
        self.skip()?;
        while self.cur() != b']' {
            if self.pos >= self.b.len() {
                return self.fail("unclosed \"[\"", start);
            }
            let v = self.value()?;
            self.nodes.push(v);
            self.skip()?;
            match self.cur() {
                b',' => {
                    self.pos += 1;
                    self.skip()?;
                }
                b']' => {}
                _ => return self.fail("expected \",\" or \"]\"", self.pos),
            }
        }
        self.pos += 1;
        let items = self.nodes.drain(mark..).collect();
        Ok(Node::List {
            items,
            form: ListForm::Brackets,
            start,
            end: self.pos,
        })
    }

    fn object(&mut self) -> Res<MapNode<'a>> {
        let start = self.pos;
        self.pos += 1;
        let mark = self.entries.len();
        self.skip()?;
        while self.cur() != b'}' {
            if self.pos >= self.b.len() {
                return self.fail("unclosed \"{\"", start);
            }
            let key_start = self.pos;
            let key = self.key()?;
            self.skip()?;
            if self.cur() != b':' {
                return self.fail(format!("expected \":\" after {key}"), self.pos);
            }
            self.pos += 1;
            self.skip()?;
            let value = self.value()?;
            let end = value.end();
            self.entries.push(Entry {
                key,
                value,
                start: key_start,
                end,
                dot: None,
                key_start,
            });
            self.skip()?;
            match self.cur() {
                b',' => {
                    self.pos += 1;
                    self.skip()?;
                }
                b'}' => {}
                _ => return self.fail("expected \",\" or \"}\"", self.pos),
            }
        }
        self.pos += 1;
        let entries: Vec<_> = self.entries.drain(mark..).collect();
        self.check_unique(&entries)?;
        Ok(MapNode {
            entries,
            form: MapForm::Object,
            groups: Vec::new(),
            start,
            end: self.pos,
        })
    }

    /// A "…" or '…' string, with JSON's escapes plus \'; borrowed from the text when it has no escape.
    fn quoted(&mut self) -> Res<Cow<'a, str>> {
        let quote = self.cur();
        let mut end = self.pos + 1;
        while !matches!(self.at(end), b'\\' | b'\n' | 0) && self.at(end) != quote {
            end += 1;
        }
        if self.at(end) == quote {
            let s = &self.src[self.pos + 1..end];
            self.pos = end + 1;
            return Ok(Cow::Borrowed(s));
        }
        self.quoted_owned().map(Cow::Owned)
    }

    fn quoted_owned(&mut self) -> Res<String> {
        let quote = self.cur();
        let start = self.pos;
        self.pos += 1;
        let mut out = String::new();
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
                return Ok(out);
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
        char::from_u32(u32::from(unit)).unwrap_or('\u{FFFD}')
    }

    /// A `…` string: raw, multi-line, only \` and \\ escaped, and never interpolated.
    fn raw(&mut self) -> Res<Cow<'a, str>> {
        if let Some(i) = self.b[self.pos + 1..]
            .iter()
            .position(|&c| c == b'`' || c == b'\\')
            && self.b[self.pos + 1 + i] == b'`'
        {
            let s = &self.src[self.pos + 1..self.pos + 1 + i];
            self.pos += i + 2;
            return Ok(Cow::Borrowed(s));
        }
        self.raw_owned().map(Cow::Owned)
    }

    fn raw_owned(&mut self) -> Res<String> {
        let start = self.pos;
        self.pos += 1;
        let mut out = String::new();
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
                return Ok(out);
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

    fn check_unique(&self, entries: &[Entry<'a>]) -> Res<()> {
        let dup = if entries.len() <= 16 {
            entries
                .iter()
                .enumerate()
                .find(|(i, e)| entries[..*i].iter().any(|p| p.key == e.key))
                .map(|(_, e)| e)
        } else {
            let mut seen = HashSet::with_capacity(entries.len());
            entries.iter().find(|e| !seen.insert(e.key.as_ref()))
        };
        match dup {
            Some(e) => self.fail(format!("duplicate key \"{}\"", e.key), e.key_start),
            None => Ok(()),
        }
    }
}

fn memchr(needle: u8, hay: &[u8]) -> Option<usize> {
    hay.iter().position(|&c| c == needle)
}

/// The tree of a whole file. An empty file is an empty map.
pub fn parse_tree(text: &str) -> Result<MapNode<'_>, SyntaxError> {
    Parser::new(text).root()
}
