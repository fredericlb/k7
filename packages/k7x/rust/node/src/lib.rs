// lib.rs — the k7x reader as a Node-API addon: `data(text)` gives `[status, json]`, the shape src/native.ts's K7Reader takes.
// A reader would get wrong that it needs napi-rs: Node-API is a stable C ABI, and the nine calls it makes are declared here.

#![allow(non_camel_case_types)]

use std::ffi::{c_char, c_void};
use std::ptr;

type napi_env = *mut c_void;
type napi_value = *mut c_void;
type napi_callback_info = *mut c_void;
type napi_status = i32;
type napi_callback = Option<unsafe extern "C" fn(napi_env, napi_callback_info) -> napi_value>;

const NAPI_OK: napi_status = 0;

unsafe extern "C" {
    fn napi_get_cb_info(
        env: napi_env,
        info: napi_callback_info,
        argc: *mut usize,
        argv: *mut napi_value,
        this: *mut napi_value,
        data: *mut *mut c_void,
    ) -> napi_status;
    fn napi_get_value_string_utf8(
        env: napi_env,
        value: napi_value,
        buf: *mut c_char,
        size: usize,
        result: *mut usize,
    ) -> napi_status;
    fn napi_create_string_utf8(
        env: napi_env,
        s: *const c_char,
        len: usize,
        result: *mut napi_value,
    ) -> napi_status;
    fn napi_create_uint32(env: napi_env, value: u32, result: *mut napi_value) -> napi_status;
    fn napi_create_array_with_length(
        env: napi_env,
        len: usize,
        result: *mut napi_value,
    ) -> napi_status;
    fn napi_set_element(
        env: napi_env,
        object: napi_value,
        index: u32,
        value: napi_value,
    ) -> napi_status;
    fn napi_create_function(
        env: napi_env,
        name: *const c_char,
        len: usize,
        cb: napi_callback,
        data: *mut c_void,
        result: *mut napi_value,
    ) -> napi_status;
    fn napi_set_named_property(
        env: napi_env,
        object: napi_value,
        name: *const c_char,
        value: napi_value,
    ) -> napi_status;
    fn napi_throw_type_error(env: napi_env, code: *const c_char, msg: *const c_char)
    -> napi_status;
}

/// The text argument as a Rust string; None when it is not a string.
unsafe fn text_arg(env: napi_env, info: napi_callback_info) -> Option<String> {
    let mut argc = 1;
    let mut arg: napi_value = ptr::null_mut();
    let mut len = 0;
    unsafe {
        let got = napi_get_cb_info(
            env,
            info,
            &mut argc,
            &mut arg,
            ptr::null_mut(),
            ptr::null_mut(),
        );
        if got != NAPI_OK
            || argc < 1
            || napi_get_value_string_utf8(env, arg, ptr::null_mut(), 0, &mut len) != NAPI_OK
        {
            return None;
        }
        let mut buf = vec![0u8; len + 1];
        if napi_get_value_string_utf8(env, arg, buf.as_mut_ptr().cast(), len + 1, &mut len)
            != NAPI_OK
        {
            return None;
        }
        buf.truncate(len);
        String::from_utf8(buf).ok()
    }
}

unsafe extern "C" fn data(env: napi_env, info: napi_callback_info) -> napi_value {
    unsafe {
        let Some(text) = text_arg(env, info) else {
            napi_throw_type_error(env, ptr::null(), c"k7x: data() takes a string".as_ptr());
            return ptr::null_mut();
        };
        let mut json = String::new();
        let status = k7x::ffi::data_json(&text, &mut json);
        let (mut out, mut s, mut j) = (ptr::null_mut(), ptr::null_mut(), ptr::null_mut());
        napi_create_array_with_length(env, 2, &mut out);
        napi_create_uint32(env, status, &mut s);
        napi_create_string_utf8(env, json.as_ptr().cast(), json.len(), &mut j);
        napi_set_element(env, out, 0, s);
        napi_set_element(env, out, 1, j);
        out
    }
}

/// Node-API's entry point: the module's exports, with `data` set on them.
///
/// # Safety
/// Called by node only, with the environment and exports object it is loading the addon into.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn napi_register_module_v1(env: napi_env, exports: napi_value) -> napi_value {
    unsafe {
        let mut f = ptr::null_mut();
        napi_create_function(
            env,
            c"data".as_ptr(),
            4,
            Some(data),
            ptr::null_mut(),
            &mut f,
        );
        napi_set_named_property(env, exports, c"data".as_ptr(), f);
    }
    exports
}

/// The Node-API version this addon is written against.
#[unsafe(no_mangle)]
pub extern "C" fn node_api_module_get_api_version_v1() -> i32 {
    8
}
