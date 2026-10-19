// napi.rs — the Node-API calls this addon makes, declared by hand: Node-API is a stable C ABI, so no binding crate is needed.
// A reader would get wrong where the symbols come from: the node that loads the addon, linked as build.rs says per platform.

#![allow(non_camel_case_types)]

use std::ffi::{c_char, c_void};
use std::ptr;

pub type napi_env = *mut c_void;
pub type napi_value = *mut c_void;
pub type napi_callback_info = *mut c_void;
pub type napi_status = i32;
pub type napi_callback = Option<unsafe extern "C" fn(napi_env, napi_callback_info) -> napi_value>;

pub const NAPI_OK: napi_status = 0;
pub const FLOAT32: i32 = 7;
pub const FLOAT64: i32 = 8;

unsafe extern "C" {
    pub fn napi_get_cb_info(
        env: napi_env,
        info: napi_callback_info,
        argc: *mut usize,
        argv: *mut napi_value,
        this: *mut napi_value,
        data: *mut *mut c_void,
    ) -> napi_status;
    pub fn napi_get_value_string_utf8(
        env: napi_env,
        value: napi_value,
        buf: *mut c_char,
        size: usize,
        result: *mut usize,
    ) -> napi_status;
    pub fn napi_get_value_double(env: napi_env, value: napi_value, result: *mut f64)
    -> napi_status;
    pub fn napi_get_typedarray_info(
        env: napi_env,
        array: napi_value,
        kind: *mut i32,
        length: *mut usize,
        data: *mut *mut c_void,
        buffer: *mut napi_value,
        offset: *mut usize,
    ) -> napi_status;
    pub fn napi_create_arraybuffer(
        env: napi_env,
        bytes: usize,
        data: *mut *mut c_void,
        result: *mut napi_value,
    ) -> napi_status;
    pub fn napi_create_typedarray(
        env: napi_env,
        kind: i32,
        length: usize,
        buffer: napi_value,
        offset: usize,
        result: *mut napi_value,
    ) -> napi_status;
    pub fn napi_create_string_utf8(
        env: napi_env,
        s: *const c_char,
        len: usize,
        result: *mut napi_value,
    ) -> napi_status;
    pub fn napi_create_uint32(env: napi_env, value: u32, result: *mut napi_value) -> napi_status;
    pub fn napi_create_array_with_length(
        env: napi_env,
        len: usize,
        result: *mut napi_value,
    ) -> napi_status;
    pub fn napi_set_element(
        env: napi_env,
        object: napi_value,
        index: u32,
        value: napi_value,
    ) -> napi_status;
    pub fn napi_get_undefined(env: napi_env, result: *mut napi_value) -> napi_status;
    pub fn napi_create_function(
        env: napi_env,
        name: *const c_char,
        len: usize,
        cb: napi_callback,
        data: *mut c_void,
        result: *mut napi_value,
    ) -> napi_status;
    pub fn napi_set_named_property(
        env: napi_env,
        object: napi_value,
        name: *const c_char,
        value: napi_value,
    ) -> napi_status;
    pub fn napi_throw_type_error(
        env: napi_env,
        code: *const c_char,
        msg: *const c_char,
    ) -> napi_status;
}

/// Up to N arguments of a call; missing ones are null.
pub unsafe fn args<const N: usize>(env: napi_env, info: napi_callback_info) -> [napi_value; N] {
    let mut argc = N;
    let mut argv = [ptr::null_mut(); N];
    unsafe {
        napi_get_cb_info(
            env,
            info,
            &mut argc,
            argv.as_mut_ptr(),
            ptr::null_mut(),
            ptr::null_mut(),
        );
    }
    argv
}

/// Throws a TypeError and gives what a callback returns after one.
pub unsafe fn type_error(env: napi_env, message: &std::ffi::CStr) -> napi_value {
    unsafe { napi_throw_type_error(env, ptr::null(), message.as_ptr()) };
    ptr::null_mut()
}

/// Sets `name` on `exports` to a function calling `cb`.
pub unsafe fn export(env: napi_env, exports: napi_value, name: &std::ffi::CStr, cb: napi_callback) {
    let mut f = ptr::null_mut();
    unsafe {
        napi_create_function(
            env,
            name.as_ptr(),
            name.to_bytes().len(),
            cb,
            ptr::null_mut(),
            &mut f,
        );
        napi_set_named_property(env, exports, name.as_ptr(), f);
    }
}
