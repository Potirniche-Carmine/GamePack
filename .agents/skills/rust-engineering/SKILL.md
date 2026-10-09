---
name: rust-engineering
description: Write, refactor, debug, review, and optimize Rust code with repository-aware guidance on ownership, API contracts, failure semantics, and cost. Use for Rust implementation and design decisions, including Cargo changes; keep the depth proportional to the requested work.
---

# Rust Engineering

Use this skill as a set of decision aids for an already capable engineer. Improve the requested code within its constraints; choose the relevant considerations rather than treating the skill as an exhaustive checklist. Correctness contracts are requirements. Design preferences are tradeoffs, and a justified alternative needs no exception ceremony.

## Establish the actual constraints

Read enough of the surrounding code, manifests, toolchain configuration, and CI to identify the edition, minimum supported Rust version (MSRV), targets, supported features, and architecture that affect the change. Respect workspace inheritance and `no_std` or allocation constraints where present. Do not infer the MSRV from the installed compiler or silently raise it to use a convenient API.

Resolve uncertain APIs against the repository's actual dependency versions and enabled features, using local source, compiler feedback, or version-matched documentation. Preserve established compatibility and error conventions unless changing them is part of the task. A small edit usually needs local context, not a repository-wide investigation.

## Let ownership explain the design

- Identify who owns each value and how long each consumer needs it. Borrow for temporary access; move or create owned data at real storage, return, and task boundaries. Returning a borrow is appropriate when the owner's lifetime is already suitable.
- If borrowing becomes awkward, inspect the decomposition: narrow field borrows, independent components, shorter scopes, reborrowing, and safe disjoint-access APIs often reveal the intended relationships. Adding a clone, reference count, or runtime borrow check can still be the clearest solution when it reflects real semantics.
- Express actual lifetime relationships. Avoid coupling independent inputs or adding `T: 'static` merely to quiet an error. Stable or generational handles can fit graphs and mutable collections better than long-lived references; account for invalidation and stale handles.
- Keep transitions valid. `Option::take`, `mem::take`/`replace`, entry APIs, and in-place mutation are useful when their intermediate and failure states match the contract. Memory safety alone does not guarantee preservation of application state.

For substantial ownership, invariant, or public-interface work, read [ownership and APIs](references/ownership-and-apis.md).

## Make contracts carry their weight

Use inherent methods for a type's behavior, free functions for algorithms that need no privileged receiver, and traits for meaningful shared contracts or extension points. Let actual variation justify abstraction.

Choose enums, newtypes, private fields, and occasionally typestate to enforce consequential invariants. Check every way values enter or change, including deserialization, conversions, defaults, and mutation. Keep visibility and bounds as narrow as the intended use allows; account for downstream compatibility before changing public signatures or trait implementations.

Represent recoverable failure with useful `Result` types, retain causes, and add context at the boundary that understands the operation. Ground panics in the repository's policy and demonstrated invariants. An `unwrap` in a test, a proven invariant, and malformed external input have different implications.

## Spend attention where it changes the outcome

Read only the reference relevant to the work; skip unrelated sections within it.

| Situation | Reference |
| --- | --- |
| Allocation, collection, layout, dispatch, compile-time, or runtime costs | [Performance](references/performance.md) |
| Resource lifecycles, shared state, async tasks, untrusted input, representation, or secrets | [Failure and boundaries](references/failure-and-boundaries.md) |
| Writing or changing an unsafe abstraction, FFI contract, or pinning-sensitive implementation | [Unsafe and FFI](references/unsafe-and-ffi.md) |
| Dependency or feature changes, choosing tests, or deeper verification | [Cargo and verification](references/cargo-and-verification.md) |

Cloning, allocation, dynamic dispatch, dependencies, unsafe code, and abstractions are tools with different costs. Prefer evidence over universal bans. Routine improvements do not need a benchmark campaign; specialized optimizations need a plausible bottleneck and measurements proportional to the claim.

## Close the feedback loop

Use the repository's formatting, checks, tests, documentation checks, and selected Clippy lints at a scope that exercises the changed behavior and configurations. Add tests for meaningful boundaries and regressions. Keep lint exceptions narrow and explain the reason when it is not evident; avoid unrelated lint cleanup.

Report the result, consequential tradeoffs, and what was actually verified. Distinguish measured improvement from an expectation, and a passing test from a general guarantee. Expand the investigation when evidence warrants it; do not turn ordinary Rust work into an unsolicited audit or redesign.
