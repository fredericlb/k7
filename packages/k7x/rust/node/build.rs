// build.rs — where the addon's napi_* symbols come from: the node that loads it, linked the way each platform requires.
// A reader would get wrong that iOS can resolve them late: it cannot, so it links NodeMobile.framework (K7X_NODEMOBILE_DIR).

use std::env;

fn main() {
    println!("cargo:rerun-if-env-changed=K7X_NODE_LIB");
    println!("cargo:rerun-if-env-changed=K7X_NODEMOBILE_DIR");
    let os = env::var("CARGO_CFG_TARGET_OS").unwrap_or_default();
    match os.as_str() {
        "windows" => {
            let dir = env::var("K7X_NODE_LIB").expect(
                "K7X_NODE_LIB: the directory of node.lib (scripts/buildAddon.mjs finds it)",
            );
            println!("cargo:rustc-link-search=native={dir}");
            println!("cargo:rustc-link-lib=dylib=node");
        }
        "ios" => {
            let dir = env::var("K7X_NODEMOBILE_DIR")
                .expect("K7X_NODEMOBILE_DIR: the directory holding NodeMobile.framework");
            println!("cargo:rustc-cdylib-link-arg=-F{dir}");
            println!("cargo:rustc-cdylib-link-arg=-framework");
            println!("cargo:rustc-cdylib-link-arg=NodeMobile");
            println!("cargo:rustc-cdylib-link-arg=-Wl,-install_name,@rpath/k7x.framework/k7x");
        }
        "macos" => {
            println!("cargo:rustc-cdylib-link-arg=-undefined");
            println!("cargo:rustc-cdylib-link-arg=dynamic_lookup");
        }
        _ => {}
    }
}
