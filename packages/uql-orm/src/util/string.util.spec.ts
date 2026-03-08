import { describe, expect, it } from 'vitest';
import {
  camelCase,
  kebabCase,
  lowerFirst,
  pascalCase,
  pluralize,
  singularize,
  snakeCase,
  upperFirst,
} from './string.util.js';

describe('string.util', () => {
  describe('kebabCase', () => {
    it('should convert camelCase to kebab-case', () => {
      expect(kebabCase('camelCase')).toBe('camel-case');
      expect(kebabCase('PascalCase')).toBe('pascal-case');
      expect(kebabCase('someHTTPRequest')).toBe('some-h-t-t-p-request');
    });

    it('should handle single word', () => {
      expect(kebabCase('word')).toBe('word');
    });

    it('should handle empty string', () => {
      expect(kebabCase('')).toBe('');
    });
  });

  describe('upperFirst', () => {
    it('should capitalize first character', () => {
      expect(upperFirst('hello')).toBe('Hello');
      expect(upperFirst('world')).toBe('World');
    });

    it('should handle already capitalized', () => {
      expect(upperFirst('Hello')).toBe('Hello');
    });
  });

  describe('lowerFirst', () => {
    it('should lowercase first character', () => {
      expect(lowerFirst('Hello')).toBe('hello');
      expect(lowerFirst('World')).toBe('world');
    });

    it('should handle already lowercase', () => {
      expect(lowerFirst('hello')).toBe('hello');
    });
  });

  describe('snakeCase', () => {
    it('should convert camelCase to snake_case', () => {
      expect(snakeCase('camelCase')).toBe('camel_case');
      expect(snakeCase('PascalCase')).toBe('pascal_case');
      expect(snakeCase('someHTTPRequest')).toBe('some_h_t_t_p_request');
    });

    it('should handle single word', () => {
      expect(snakeCase('word')).toBe('word');
    });

    it('should handle empty string', () => {
      expect(snakeCase('')).toBe('');
    });

    it('should handle null/undefined', () => {
      expect(snakeCase(null as unknown as string)).toBe(null);
      expect(snakeCase(undefined as unknown as string)).toBe(undefined);
    });
  });

  describe('pascalCase', () => {
    it('should convert snake_case to PascalCase', () => {
      expect(pascalCase('user_profile')).toBe('UserProfile');
      expect(pascalCase('some_long_name')).toBe('SomeLongName');
    });

    it('should convert kebab-case to PascalCase', () => {
      expect(pascalCase('some-text')).toBe('SomeText');
      expect(pascalCase('my-component-name')).toBe('MyComponentName');
    });

    it('should handle spaces', () => {
      expect(pascalCase('hello world')).toBe('HelloWorld');
    });

    it('should handle empty string', () => {
      expect(pascalCase('')).toBe('');
    });

    it('should handle single word', () => {
      expect(pascalCase('word')).toBe('Word');
    });

    it('should handle mixed delimiters', () => {
      expect(pascalCase('some_text-here')).toBe('SomeTextHere');
    });
  });

  describe('camelCase', () => {
    it('should convert snake_case to camelCase', () => {
      expect(camelCase('user_profile')).toBe('userProfile');
      expect(camelCase('some_long_name')).toBe('someLongName');
    });

    it('should convert kebab-case to camelCase', () => {
      expect(camelCase('some-text')).toBe('someText');
      expect(camelCase('my-component-name')).toBe('myComponentName');
    });

    it('should handle PascalCase', () => {
      expect(camelCase('SomeText')).toBe('sometext');
    });

    it('should handle empty string', () => {
      expect(camelCase('')).toBe('');
    });

    it('should handle single word', () => {
      expect(camelCase('word')).toBe('word');
    });
  });

  describe('singularize', () => {
    it('should remove simple plural -s', () => {
      expect(singularize('users')).toBe('user');
      expect(singularize('posts')).toBe('post');
      expect(singularize('comments')).toBe('comment');
    });

    it('should handle -ies to -y', () => {
      expect(singularize('categories')).toBe('category');
      expect(singularize('stories')).toBe('story');
      expect(singularize('entries')).toBe('entry');
    });

    it('should handle -ses/-xes/-zes', () => {
      expect(singularize('classes')).toBe('class');
      expect(singularize('boxes')).toBe('box');
      expect(singularize('quizzes')).toBe('quizz');
    });

    it('should not singularize words ending in ss', () => {
      expect(singularize('boss')).toBe('boss');
      expect(singularize('class')).toBe('class');
    });

    it('should handle empty string', () => {
      expect(singularize('')).toBe('');
    });

    it('should handle already singular words', () => {
      expect(singularize('user')).toBe('user');
      expect(singularize('post')).toBe('post');
    });
  });

  describe('pluralize', () => {
    it('should add -s for regular words', () => {
      expect(pluralize('user')).toBe('users');
      expect(pluralize('post')).toBe('posts');
      expect(pluralize('comment')).toBe('comments');
    });

    it('should handle -y to -ies', () => {
      expect(pluralize('category')).toBe('categories');
      expect(pluralize('story')).toBe('stories');
      expect(pluralize('entry')).toBe('entries');
    });

    it('should not change -y preceded by vowel', () => {
      expect(pluralize('day')).toBe('days');
      expect(pluralize('key')).toBe('keys');
    });

    it('should add -es for s/x/z/ch/sh endings', () => {
      expect(pluralize('class')).toBe('classes');
      expect(pluralize('box')).toBe('boxes');
      expect(pluralize('quiz')).toBe('quizes');
      expect(pluralize('watch')).toBe('watches');
      expect(pluralize('wish')).toBe('wishes');
    });

    it('should handle empty string', () => {
      expect(pluralize('')).toBe('');
    });
  });
});
