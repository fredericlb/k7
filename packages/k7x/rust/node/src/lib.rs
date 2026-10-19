// lib.rs — the app's Node-API addon: the k7x reader's `data(text)` giving `[status, json]`, and the waveform measure (waveform.rs).
// A reader would get wrong that it is k7x's alone: it is the one native library a JIT-less node loads, named in K7X_ADDON (docs/rust.md).

mod napi;
mod waveform;

use napi::*;
use std::ptr;

/// The text argument as a Rust string; None when it is not a string.
unsafe fn text_arg(env: napi_env, info: napi_callback_info) -> Option<String> {
    let [arg] = unsafe { args::<1>(env, info) };
    let mut len = 0;
    unsafe {
        if arg.is_null()
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
            return type_error(env, c"k7x: data() takes a string");
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

/// Node-API's entry point: the module's exports, with every function set on them.
///
/// # Safety
/// Called by node only, with the environment and exports object it is loading the addon into.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn napi_register_module_v1(env: napi_env, exports: napi_value) -> napi_value {
    unsafe {
        export(env, exports, c"data", Some(data));
        export(env, exports, c"wfReset", Some(waveform::wf_reset));
        export(env, exports, c"wfPush", Some(waveform::wf_push));
        export(env, exports, c"wfMeasure", Some(waveform::wf_measure));
        export(env, exports, c"wfAutocorr", Some(waveform::wf_autocorr));
    }
    exports
}

/// The Node-API version this addon is written against.
#[unsafe(no_mangle)]
pub extern "C" fn node_api_module_get_api_version_v1() -> i32 {
    8
}
