/** Why a name the codemod writes is refused: a file already binds it. */
export const nameClash = (name: string) => `'${name}' is already named here, and the codemod writes it`;

/** Why a defined column's foreign key is refused: no relation joins on it, and none can be written for it. */
export const UNJOINED_FOREIGN_KEY =
  "references another entity, and no relation can be named for it: declare one in '.relations()', as 'rel.manyToOne(Target, { references: (row) => row.key })'";

/** Why a joined column's `onDelete` is refused: its relation states another, or takes options the codemod cannot write into. */
export const ON_DELETE_ON_RELATION =
  "joins through a relation that cannot take its 'onDelete': settle the action in that relation's options";

/** Why a foreign key with no type is refused: a defined column states its own, which only its target's key implied. */
export const NO_KEY_TYPE = "takes its type from its target: write its builder, f.number() and so on, as its key's type";
