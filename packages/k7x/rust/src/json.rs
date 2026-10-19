// json.rs — a tree written out as JSON: its plain data, as toJS gives it, or the whole tree with its spans.
// The tree form counts spans in UTF-16 units so it compares field for field with the TypeScript parser's (docs/rust.md).

use crate::ast::{Entry, ListForm, MapForm, MapNode, Node, Scalar};
use std::fmt::Write;

/// The plain value of a node, as JSON text.
pub fn value_json(node: &Node, out: &mut String) {
    match node {
        Node::Scalar { value, .. } => scalar_json(value, out),
        Node::List { items, .. } => {
            out.push('[');
            for (i, n) in items.iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                value_json(n, out);
            }
            out.push(']');
        }
        Node::Map(m) => map_value_json(m, out),
    }
}

pub fn map_value_json(m: &MapNode, out: &mut String) {
    out.push('{');
    for (i, e) in m.entries.iter().enumerate() {
        if i > 0 {
            out.push(',');
        }
        string_json(e.key, out);
        out.push(':');
        value_json(&e.value, out);
    }
    out.push('}');
}

fn scalar_json(s: &Scalar, out: &mut String) {
    match s {
        Scalar::Str(v) => string_json(v, out),
        Scalar::Num(n) if n.is_nan() => out.push_str("null"),
        Scalar::Num(n) if n.is_infinite() => {
            out.push_str(if *n > 0.0 { "1e999" } else { "-1e999" })
        }
        Scalar::Num(n) if *n == 0.0 && n.is_sign_negative() => out.push_str("-0"),
        Scalar::Num(n) if n.fract() == 0.0 && n.abs() < 1e15 => {
            write!(out, "{}", *n as i64).unwrap()
        }
        Scalar::Num(n) => write!(out, "{n:e}").unwrap(),
        Scalar::Bool(b) => out.push_str(if *b { "true" } else { "false" }),
        Scalar::Null => out.push_str("null"),
    }
}

pub(crate) fn string_json(s: &str, out: &mut String) {
    out.push('"');
    for c in s.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            c if (c as u32) < 0x20 => write!(out, "\\u{:04x}", c as u32).unwrap(),
            c => out.push(c),
        }
    }
    out.push('"');
}

/// Byte offset → UTF-16 offset, for every byte of the text and its end.
pub fn utf16_offsets(text: &str) -> Vec<usize> {
    let mut map = vec![0; text.len() + 1];
    let mut u = 0;
    for (i, c) in text.char_indices() {
        for k in 0..c.len_utf8() {
            map[i + k] = u;
        }
        u += c.len_utf16();
    }
    map[text.len()] = u;
    map
}

/// The whole tree as JSON, shaped as ../src/ast.ts's nodes, spans in UTF-16 units.
pub fn tree_json(node: &Node, u: &[usize], out: &mut String) {
    match node {
        Node::Scalar { value, start, end } => {
            out.push_str("{\"kind\":\"scalar\",\"value\":");
            scalar_json(value, out);
            write!(out, ",\"start\":{},\"end\":{}}}", u[*start], u[*end]).unwrap();
        }
        Node::List {
            items,
            form,
            start,
            end,
        } => {
            let form = if *form == ListForm::Args {
                "args"
            } else {
                "brackets"
            };
            write!(out, "{{\"kind\":\"list\",\"form\":\"{form}\",\"items\":[").unwrap();
            for (i, n) in items.iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                tree_json(n, u, out);
            }
            write!(out, "],\"start\":{},\"end\":{}}}", u[*start], u[*end]).unwrap();
        }
        Node::Map(m) => map_tree_json(m, u, out),
    }
}

pub fn map_tree_json(m: &MapNode, u: &[usize], out: &mut String) {
    let form = match m.form {
        MapForm::Root => "root",
        MapForm::Chain => "chain",
        MapForm::Object => "object",
    };
    write!(out, "{{\"kind\":\"map\",\"form\":\"{form}\",\"entries\":[").unwrap();
    for (i, e) in m.entries.iter().enumerate() {
        if i > 0 {
            out.push(',');
        }
        entry_json(e, u, out);
    }
    out.push_str("],\"groups\":[");
    for (i, (a, b)) in m.groups.iter().enumerate() {
        if i > 0 {
            out.push(',');
        }
        write!(out, "[{a},{b}]").unwrap();
    }
    write!(out, "],\"start\":{},\"end\":{}}}", u[m.start], u[m.end]).unwrap();
}

fn entry_json(e: &Entry, u: &[usize], out: &mut String) {
    out.push_str("{\"key\":");
    string_json(e.key, out);
    out.push_str(",\"value\":");
    tree_json(&e.value, u, out);
    let dot = e.dot.map_or("null".to_owned(), |d| u[d].to_string());
    write!(
        out,
        ",\"start\":{},\"end\":{},\"dot\":{dot},\"keyStart\":{},\"keyEnd\":{}}}",
        u[e.start], u[e.end], u[e.key_start], u[e.key_end]
    )
    .unwrap();
}
