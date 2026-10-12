// Types for dev-hosts.mjs, which the vite configs import. A .mjs has no declarations of its
// own, and the apps that typecheck their own vite.config.ts under noImplicitAny fail on that
// rather than on anything real — so the pair lives here rather than in every tsconfig.

export declare const DEV_HOST: string;
export declare const ALIAS_DEV_HOST: string;
export declare const K7_ALIAS_DEV_HOST: string;
export declare const LEGACY_DEV_HOSTS: string[];
export declare const AUTH_BACKEND_PORT: number;
