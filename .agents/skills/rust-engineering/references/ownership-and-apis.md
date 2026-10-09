# Ownership and APIs

Use the parts relevant to changing data relationships, invariants, or callable interfaces.

## Borrow the part that does the work

When a helper takes `&mut self`, its signature borrows the whole receiver even if its implementation only touches one field. Pass the fields it needs, extract an independent component, or use a short local borrow when that better describes the operation. Preserve useful encapsulation; scattering fields across callers is not automatically an improvement.

Reborrow mutable references when access is temporary. For simultaneous mutation, use disjoint fields or safe APIs such as `split_at_mut`; verify newer collection APIs against the MSRV. Choose between checked indices, handles, and references based on mutation and invalidation requirements. A plain index does not detect slot reuse; a generational handle needs a generation check and a considered reuse policy.

Use independent lifetimes when relationships are independent. `&'a mut self` on a type parameterized by `'a` can accidentally borrow the receiver for far longer than a call needs. `T: 'static` means the type contains no shorter-lived borrows, not that its values live forever. An owned value may satisfy it without leaking memory.

## Move values without losing the contract

Use `Option::take` when absence is a valid state, `mem::take` when the default is valid, and `mem::replace` when a specific replacement is needed. A temporary placeholder may be observable after `?`, unwinding, or a callback. These operations transfer ownership; they do not implement rollback. See the standard library's [`mem::take` contract](https://doc.rust-lang.org/std/mem/fn.take.html).

If a failed operation must preserve the old state, validate or prepare first and commit after success, or use a guard with a meaningful restoration strategy. Decide whether incremental mutation, rollback, or a documented partial result fits the API. Do not build a transaction framework for an operation whose failure semantics are already simple.

An entry API can combine lookup and mutation. Weigh eager owned-key creation against a borrowed lookup when hits dominate; neither approach wins universally.

## Encode and preserve meaning

An enum can eliminate contradictory flags; a newtype can distinguish units or enforce validated input; private fields can protect a relationship between values. Typestate is useful when compile-time sequencing earns its extra types and ergonomics.

Validation has to cover all safe entry points. A checked constructor is insufficient if a derived deserializer, unchecked `From`, `Default`, setter, or exposed mutable reference can bypass the invariant. Use fallible conversions for genuinely fallible construction. Do not derive a trait solely because every field permits it.

Equal values must hash alike, and equality and ordering implementations must agree. Derived ordering follows field and variant declaration order, which may not match domain meaning. `Borrow<Q>` additionally promises compatible equality, ordering, and hashing between owned and borrowed representations; `AsRef<Q>` only provides a view. A case-insensitive key generally cannot implement `Borrow<str>` with ordinary string semantics. See [`Borrow`](https://doc.rust-lang.org/std/borrow/trait.Borrow.html).

`Deref` and especially `DerefMut` expose implicit access and target methods as part of an API. Use them deliberately for pointer-like behavior, considering invariant escape paths and future method collisions. Explicit accessors often communicate domain wrappers better.

## Keep the interface proportionate

Accept `&str`, slices, or other borrowed views when access is sufficient; accept owned values when retaining or consuming them is the operation. Generic conversion bounds can improve caller ergonomics, but also affect inference, diagnostics, and code generation. Require `Clone`, `Send`, `Sync`, or lifetime bounds where needed, not by habit.

Builders earn their place with meaningful configuration or construction rules; wrappers and macros earn theirs by hiding a useful invariant or repeated mechanism. Consider visibility, trait coherence, downstream implementations, and source compatibility before expanding or replacing public contracts.
