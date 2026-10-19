// ffi.rs — the C ABI every host calls: WebAssembly where there is a JIT, a native library on iOS (docs/rust.md).
// A reader would get wrong what crosses it: UTF-8 text in, JSON text out, because JSON.parse builds JS values faster than any binding can.

use crate::json::{map_value_json, string_json};
use crate::parse::{SyntaxError, parse_tree_lossless};
use bumpalo::Bump;
use std::cell::RefCell;

/// The data as JSON, as toJS would give it.
pub const OK: u32 = 0;
/// A syntax error, as JSON `{message, offset, line, column}`, the offset in UTF-16 units.
pub const SYNTAX_ERROR: u32 = 1;
/// The data holds what a Rust string cannot (a lone surrogate escape): the caller parses in JS instead.
pub const UNREPRESENTABLE: u32 = 2;

thread_local! {
    static INPUT: RefCell<Vec<u8>> = const { RefCell::new(Vec::new()) };
    static OUTPUT: RefCell<String> = const { RefCell::new(String::new()) };
    static ARENA: RefCell<Bump> = RefCell::new(Bump::new());
}

/// A buffer of `len` bytes to write the text into, valid until the next call on this thread.
#[unsafe(no_mangle)]
pub extern "C" fn k7x_input(len: usize) -> *mut u8 {
    INPUT.with(|i| {
        let mut i = i.borrow_mut();
        i.resize(len, 0);
        i.as_mut_ptr()
    })
}

/// Parses the first `len` bytes of the input buffer; the result is at `k7x_output_ptr` / `k7x_output_len`.
#[unsafe(no_mangle)]
pub extern "C" fn k7x_data(len: usize) -> u32 {
    INPUT.with(|i| {
        let input = i.borrow();
        let Ok(text) = std::str::from_utf8(&input[..len.min(input.len())]) else {
            return UNREPRESENTABLE;
        };
        OUTPUT.with(|o| data_json(text, &mut o.borrow_mut()))
    })
}

/// What every binding answers for one text: a status above, and its JSON written into `out`.
pub fn data_json(text: &str, out: &mut String) -> u32 {
    out.clear();
    ARENA.with(|a| {
        let mut arena = a.borrow_mut();
        arena.reset();
        match parse_tree_lossless(text, &arena) {
            Ok(Some(tree)) => {
                map_value_json(&tree, out);
                OK
            }
            Ok(None) => UNREPRESENTABLE,
            Err(e) => {
                error_json(text, &e, out);
                SYNTAX_ERROR
            }
        }
    })
}

#[unsafe(no_mangle)]
pub extern "C" fn k7x_output_ptr() -> *const u8 {
    OUTPUT.with(|o| o.borrow().as_ptr())
}

#[unsafe(no_mangle)]
pub extern "C" fn k7x_output_len() -> usize {
    OUTPUT.with(|o| o.borrow().len())
}

fn error_json(text: &str, e: &SyntaxError, out: &mut String) {
    out.push_str("{\"message\":");
    string_json(&e.message, out);
    let offset = text[..e.offset].encode_utf16().count();
    out.push_str(&format!(
        ",\"offset\":{offset},\"line\":{},\"column\":{}}}",
        e.line, e.column
    ));
}
