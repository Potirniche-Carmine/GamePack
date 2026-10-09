# Failure and Boundaries

Read the sections that match the resource, concurrency, or input boundary being changed.

## Errors and resource lifecycles

Give callers enough structure to make recovery decisions and enough context to diagnose the operation. Preserve underlying causes where useful instead of flattening every error into a string. Match typed domain errors and application-level context to the repository's conventions; avoid both enormous universal error enums and gratuitous wrapper layers.

Use RAII to release resources on normal exits and unwinding. Be aware of temporary and guard drop scopes, especially around locks, callbacks, and suspension. RAII is not a guarantee that destructors run after aborts or process termination, and safe code can intentionally leak values.

Define what happens after partial initialization or a failed multi-step operation. A guard can handle local cleanup, but external effects may require explicit commit, compensation, or a documented partial outcome. Expose fallible `finish`, `flush`, `close`, or `commit` operations when the caller needs their errors; `Drop` cannot return a `Result`. Avoid a second panic while unwinding.

## Shared state

Prefer a clear owner when sharing is incidental. Use `Rc` for suitable single-threaded sharing and `Arc` when cross-thread shared ownership is needed. `Arc` does not make its contents thread-safe. `Cell`/`RefCell`, locks, message passing, and atomics solve different access problems; select the simplest one with the required semantics.

Scoped concurrency can allow borrowing and avoid unnecessary ownership transfers. Keep critical sections focused and consider lock ordering, reentrancy, and poisoning or recovery policy. Move expensive processing outside a lock when doing so preserves consistency. Snapshotting with a clone can be a good tradeoff.

Choose atomic ordering from the synchronization relationship. For example, an independent statistic may need only relaxed atomicity; publishing initialized data needs an appropriate visibility protocol. Neither stronger ordering nor stress tests alone establish that a multi-step algorithm is correct.

## Async work

Separate blocking I/O and substantial CPU work from executor workers using the runtime's supported facilities. Bound blocking work as well as async work. Choose a synchronous or async lock based on contention and whether a guard genuinely must span suspension; merely being inside an async function does not decide this.

For each spawned task, identify who observes completion and errors, and who cancels or joins it. Bounds on queues, active operations, and retained bytes prevent a concurrency limit from hiding an unbounded backlog. Define backpressure or overload behavior and how shutdown drains, rejects, cancels, and cleans up.

Cancellation can drop a future at a suspension point. Inspect state removed with `take`, partial I/O, protocol progress, held permits, and external effects. A timeout does not necessarily cancel spawned or blocking work. Retrying may duplicate effects; use the operation's real guarantees. In selection loops, verify cancellation and fairness behavior against the actual runtime and API, such as [Tokio's `select!` documentation](https://docs.rs/tokio/latest/tokio/macro.select.html), selecting the repository's version.

## Inputs and representations

Bound bytes, item counts, nesting, decompression output, and work where external input can exhaust resources. Check length arithmetic and conversions before allocation or slicing. Choose checked, saturating, or wrapping overflow semantics deliberately when overflow is meaningful; do not rely on debug and release behaving identically. Select hashing against the actual collision-attack exposure before substituting a faster hasher.

Treat `str` as UTF-8, and bytes as bytes. Byte offsets, Unicode scalar values, and grapheme clusters answer different questions. Keep paths in `Path`/`PathBuf` and OS strings where appropriate; lossy display is not a round-trip representation.

Specify endianness, widths, validation, and versioning for wire and storage formats. Rust's default struct layout is not a serialization format; `repr(C)` alone does not make arbitrary bytes valid or a format portable. See the [Rust layout guarantees](https://doc.rust-lang.org/reference/type-layout.html).

## Observability and secrets

Keep useful operation names, identifiers, and error causes while considering who can see each sink. Derived `Debug`, tracing arguments, error context, serialization, and diagnostic dumps can expose credentials or payloads indirectly. Redact or skip sensitive fields at the relevant boundary; do not turn all diagnostics into opaque failures.

Avoid needless copies and lifetimes for secrets. If erasure is required by the threat model, use a suitable established mechanism and account for prior copies and compiler behavior; ordinary dropping or clearing a buffer is not a secure-erasure guarantee.
