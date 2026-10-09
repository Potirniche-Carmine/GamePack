# Unsafe and FFI

Use for changes to unsafe implementations or foreign interfaces, not merely because a dependency uses unsafe internally.

## State the safety argument

Prefer an existing suitable safe API when it carries the needed guarantees. When unsafe is justified, keep the trusted surface understandable and document each caller obligation or locally established fact. A useful `SAFETY` comment explains why the operation is valid here, rather than repeating its name.

Track allocation lifetime and provenance, aliasing, bounds, alignment, initialization, valid bit patterns, and who may mutate or free memory. Constructing a reference makes promises even before it is read. `MaybeUninit` allows uninitialized storage, not arbitrary use of an uninitialized `T`; `ManuallyDrop` does not establish validity or prevent double ownership. Audit partial initialization and panic paths as well as the successful path. The [Rust Reference's undefined-behavior rules](https://doc.rust-lang.org/reference/behavior-considered-undefined.html) describe requirements and areas whose exact model is still developing.

A safe wrapper must remain sound for every input and call sequence its safe interface permits. Check exposed mutation, callbacks, reentrancy, destruction, and custom trait implementations that the wrapper relies on. Do not rely on a user's `Drop` being called for memory safety. Manual `Send`/`Sync` implementations need a thread-safety argument covering the actual ownership and access model.

## Pinning and layout

Pinning is a contract about address-sensitive values and their lifetime, not a general solution to borrow errors. Check `Unpin`, projection, replacement, and destruction together; a pinned outer value does not automatically make every projection sound. Use established projection facilities when they remove subtle obligations. Consult the [`std::pin` contract](https://doc.rust-lang.org/std/pin/index.html) for the operation being implemented.

Rely only on documented layout guarantees for the exact types and representation attributes. Padding, invalid enum discriminants, reference validity, and platform differences make many apparent byte reinterpretations unsound. Size equality alone is not a conversion proof. See [type layout](https://doc.rust-lang.org/reference/type-layout.html).

## Foreign contracts

Specify ABI, layout, ownership transfer, allocator pairing, pointer/length validity, callback lifetime, threading, and shutdown behavior on both sides. Establish whether unwinding may cross the chosen ABI; handle Rust panics and foreign exceptions according to that contract and the project's panic strategy. Avoid assuming that a C-shaped declaration guarantees compatible lifetime or thread semantics. The [Rustonomicon FFI guidance](https://doc.rust-lang.org/nomicon/ffi.html) is a starting point; verify the foreign library's actual contract too.

Exercise realistic boundaries and failure paths. Miri and suitable sanitizers can expose defects in covered executions, but passing runs do not establish general soundness or validate an unexecuted foreign implementation. See [targeted verification](cargo-and-verification.md) for choosing additional tools.
