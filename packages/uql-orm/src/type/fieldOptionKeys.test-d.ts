import { Entity, Field, Id } from '../entity/index.js';

/** A typo'd option used to compile and be silently ignored: the decorators capture a naked type
 * parameter, and TypeScript skips excess-property checking on one of those. */
@Entity()
class TypoRejected {
  @Id({ type: Number }) id?: number;
  // @ts-expect-error - 'nulable' is not an option
  @Field({ type: String, nulable: true }) a?: string;
  // @ts-expect-error - registration works this out; it is not authorable
  @Field({ type: String, typeFromReference: true }) b?: string;
  // @ts-expect-error - likewise
  @Field({ type: String, referencedKey: 'id' }) c?: string;
}

@Entity()
class RealOptionsStillCompile {
  // @ts-expect-error - 'isd' is not an option
  @Id({ type: Number, isd: true }) id?: number;
  @Field({ type: String, name: 'the_name', nullable: false, unique: true, index: true }) a?: string;
  @Field({ type: Number, precision: 10, scale: 2, defaultValue: 0 }) b?: number;
}

export type _ = [TypoRejected, RealOptionsStillCompile];
