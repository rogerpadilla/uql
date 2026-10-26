/**
 * The Standard Schema interface (standardschema.dev, v1), vendored as types so no schema library is a dependency. Zod,
 * Valibot and ArkType implement it, and a payload is typed by its output.
 */
export interface StandardSchemaV1<Input = unknown, Output = Input> {
  readonly '~standard': {
    readonly version: 1;
    readonly vendor: string;
    readonly validate: (value: unknown) => StandardSchemaV1Result<Output> | Promise<StandardSchemaV1Result<Output>>;
    readonly types?: { readonly input: Input; readonly output: Output } | undefined;
  };
}

/** A validation's outcome: the value it accepts, or the issues it found. */
export type StandardSchemaV1Result<Output> =
  | { readonly value: Output; readonly issues?: undefined }
  | { readonly issues: readonly StandardSchemaV1Issue[] };

export interface StandardSchemaV1Issue {
  readonly message: string;
  readonly path?: readonly (PropertyKey | { readonly key: PropertyKey })[] | undefined;
}
