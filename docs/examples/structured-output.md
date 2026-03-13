# Structured Output

Generate typed objects using `GenerationSchema` and `respondWithSchema()`.

<<< @/../examples/structured-output/structured-output.ts

## What This Shows

1. Define a schema with `GenerationSchema` and typed properties
2. Use `GenerationGuide.range()` to constrain numeric values
3. Extract typed values with `content.value<T>(key)`
4. Map results to a TypeScript interface

::: tip
For new code, consider [`generable()`](/guide/structured-output#declarative-schemas-with-generable) — it builds the schema and gives you a typed `parse()` method in one step, eliminating the manual interface and `value()` calls.
:::
