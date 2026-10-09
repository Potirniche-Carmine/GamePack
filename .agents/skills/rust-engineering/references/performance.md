# Performance

Use this reference when cost matters to the requested change. Distinguish a straightforward removal of redundant work from a claim that needs measurement.

## Follow data and work

- Identify what a clone actually does. `String` and many container clones copy owned contents; `Arc::clone` shares the allocation and updates a reference count. A cheap clone can still add contention or extend retention. A deep clone may be a sensible way to simplify a small, cold operation.
- Reuse buffers when repeated allocation matters. Reserve from a credible, bounded estimate; untrusted lengths and wildly pessimistic capacities are poor allocation plans. Reusing capacity can also retain an unusually large allocation indefinitely.
- `Cow` helps when a borrowed result is common and can remain borrowed. If every caller immediately needs ownership, it may only move the allocation and add branching or lifetime complexity.
- Zero-copy can reduce copying while retaining a large backing buffer for a tiny view, extending lifetimes, or adding validation and alignment constraints. Compare total live memory and processing cost, not just copy counts.
- Use lazy construction when work is expensive and often unused. Avoid replacing a cheap eager value with elaborate deferred machinery without benefit.

## Choose algorithms before syntax

Use iterator adapters or loops according to clarity, error handling, and control flow. An intermediate collection may be redundant, or it may establish a useful ownership boundary or enable reuse. Follow how often work occurs: repeated scans, nested membership tests, repeated sorting, and removing from the front of a `Vec` can hide quadratic behavior.

Choose collections for access patterns, ordering requirements, update frequency, and input scale. A contiguous `Vec` or sorted slice can outperform pointer-heavy structures for small or scan-heavy workloads. Hashing and tree operations have their own locality, allocation, and worst-case considerations.

Inspect enum size when a rare large variant inflates every element. Boxing that payload may shrink the common representation but adds allocation and indirection. Measure representative variant distributions before complicating layout. Count pointer chasing, cache locality, and retained backing allocations alongside asymptotic complexity.

## Include compilation and dispatch

Static dispatch can enable inlining and specialization while increasing monomorphized code, compile time, and instruction-cache pressure. Dynamic dispatch can simplify heterogeneous storage and reduce generated code while adding indirection and limiting some optimization. Neither requires a blanket preference.

For substantial repeated generic work, a thin generic interface that converts into a concrete implementation can reduce duplication. Check that conversion does not introduce a larger runtime cost. Proc macros, derives, and generated code also affect builds and diagnostics; inspect the expanded shape only when it helps explain the problem.

## Measure the claim

Use representative release workloads, realistic input distributions, and the deployment target when material. Establish a baseline and compare the changed implementation under comparable conditions. Examine allocations, peak and retained memory, contention, throughput, or tail latency according to the actual concern; consider compile time and binary size when generics or dependencies change substantially.

Check output equivalence and relevant regression cases alongside performance. A microbenchmark, a debug build, or a single warm input is limited evidence. Prefer a specialized hasher, allocator, collection, unsafe fast path, or custom synchronization only when its measured benefit justifies the maintenance and failure modes in this repository.
