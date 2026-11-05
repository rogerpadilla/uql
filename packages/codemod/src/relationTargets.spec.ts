import { describe, expect, it } from 'vitest';
import { toRelationTargets } from './relationTargets.js';

const rewrite = (text: string) => toRelationTargets('/entities.ts', text);

describe('toRelationTargets', () => {
  it("should pass a relation's target first, its other options after it", () => {
    expect(
      rewrite(`class Post { @ManyToOne({ entity: () => User, references: (post) => post.authorId }) author?: User; }`),
    ).toBe(`class Post { @ManyToOne(() => User, { references: (post) => post.authorId }) author?: User; }`);
  });

  it('should drop the options where the target was the only one', () => {
    expect(rewrite(`class User { @OneToMany({ entity: () => Post }) posts?: Post[]; }`)).toBe(
      `class User { @OneToMany(() => Post) posts?: Post[]; }`,
    );
  });

  it('should read the target wherever the options name it, and keep their layout', () => {
    expect(
      rewrite(`class Post {
  @ManyToMany({
    through: () => PostTag,
    entity: () => Tag,
    cascade: true,
  })
  tags?: Tag[];
}`),
    ).toBe(`class Post {
  @ManyToMany(() => Tag, {
    through: () => PostTag,
    cascade: true,
  })
  tags?: Tag[];
}`);
    expect(
      rewrite(`class Post { @OneToOne({ mappedBy: (p) => p.post, entity: () => Profile }) profile?: Profile; }`),
    ).toBe(`class Post { @OneToOne(() => Profile, { mappedBy: (p) => p.post }) profile?: Profile; }`);
  });

  it('should keep a comment on the option after the target', () => {
    expect(
      rewrite(`class Post {
  @ManyToOne({
    entity: () => User,
    // why
    references: (post) => post.authorId,
  })
  author?: User;
}`),
    ).toBe(`class Post {
  @ManyToOne(() => User, {
    // why
    references: (post) => post.authorId,
  })
  author?: User;
}`);
  });

  it('should leave a relation already passing its target, and options it cannot read', () => {
    const written = `class Post { @ManyToOne(() => User) author?: User; @OneToMany(options) posts?: Post[]; @ManyToOne({ ...shared }) editor?: User; }`;
    expect(rewrite(written)).toBe(written);
  });
});
