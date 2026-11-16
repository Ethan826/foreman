import { dlopen, FFIType } from "bun:ffi";
const lib = dlopen("/usr/lib/libSystem.B.dylib", { clock_gettime_nsec_np: { args: [FFIType.i32], returns: FFIType.u64 } });
const t0 = performance.now();
const a = lib.symbols.clock_gettime_nsec_np(6); // _CLOCK_MONOTONIC = 6 on macOS
const b = lib.symbols.clock_gettime_nsec_np(6);
console.log("ffi mono ns", a, "delta", b - a, "hrtime", process.hrtime.bigint(), "ffi call us", ((performance.now()-t0)*1000).toFixed(1));
