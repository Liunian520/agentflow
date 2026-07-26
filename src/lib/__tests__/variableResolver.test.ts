import { describe, it, expect } from 'vitest';
import { resolveVariables, resolveVariableValue, getFilters } from '../variableResolver';

describe('variableResolver', () => {
  describe('resolveVariables - basic variable substitution', () => {
    it('should substitute simple variables', () => {
      const result = resolveVariables('Hello {{name}}!', { name: 'World' });
      expect(result).toBe('Hello World!');
    });

    it('should substitute multiple variables', () => {
      const result = resolveVariables('{{greeting}} {{name}}!', {
        greeting: 'Hello',
        name: 'World',
      });
      expect(result).toBe('Hello World!');
    });

    it('should handle whitespace inside braces', () => {
      const result = resolveVariables('Hello {{  name  }}!', { name: 'World' });
      expect(result).toBe('Hello World!');
    });

    it('should return empty string for undefined variables', () => {
      const result = resolveVariables('Hello {{unknown}}!', {});
      expect(result).toBe('Hello !');
    });

    it('should return empty string for null variables', () => {
      const result = resolveVariables('Hello {{name}}!', { name: null });
      expect(result).toBe('Hello !');
    });

    it('should handle empty template', () => {
      const result = resolveVariables('', { name: 'World' });
      expect(result).toBe('');
    });

    it('should handle template with no variables', () => {
      const result = resolveVariables('Hello World!', { name: 'Test' });
      expect(result).toBe('Hello World!');
    });

    it('should handle number variables', () => {
      const result = resolveVariables('Count: {{count}}', { count: 42 });
      expect(result).toBe('Count: 42');
    });

    it('should handle boolean variables', () => {
      const result = resolveVariables('Active: {{active}}', { active: true });
      expect(result).toBe('Active: true');
    });

    it('should handle object variables as JSON', () => {
      const result = resolveVariables('Data: {{obj}}', { obj: { a: 1, b: 2 } });
      expect(result).toBe('Data: {"a":1,"b":2}');
    });

    it('should handle array variables as JSON', () => {
      const result = resolveVariables('List: {{arr}}', { arr: [1, 2, 3] });
      expect(result).toBe('List: [1,2,3]');
    });
  });

  describe('resolveVariables - nested property access', () => {
    it('should access nested object properties', () => {
      const result = resolveVariables('{{user.name}}', {
        user: { name: 'Alice' },
      });
      expect(result).toBe('Alice');
    });

    it('should access deeply nested properties', () => {
      const result = resolveVariables('{{a.b.c.d}}', {
        a: { b: { c: { d: 'deep' } } },
      });
      expect(result).toBe('deep');
    });

    it('should return empty string for missing nested property', () => {
      const result = resolveVariables('{{user.address.city}}', {
        user: { name: 'Alice' },
      });
      expect(result).toBe('');
    });

    it('should return empty string when root is undefined', () => {
      const result = resolveVariables('{{user.name}}', {});
      expect(result).toBe('');
    });

    it('should access array index via nested path', () => {
      const result = resolveVariables('{{items.0}}', { items: ['a', 'b', 'c'] });
      expect(result).toBe('a');
    });
  });

  describe('resolveVariables - node output references', () => {
    it('should resolve node output references', () => {
      const result = resolveVariables('Result: {{node1.output}}', {}, {
        nodeOutputs: {
          node1: { output: 'hello' },
        },
      });
      expect(result).toBe('Result: hello');
    });

    it('should prefer variables over node outputs when name conflicts', () => {
      const result = resolveVariables('{{value}}', { value: 'from-variable' }, {
        nodeOutputs: {
          value: { output: 'from-node' },
        },
      });
      expect(result).toBe('from-variable');
    });

    it('should resolve node output with nested property', () => {
      const result = resolveVariables('{{node1.data.name}}', {}, {
        nodeOutputs: {
          node1: { data: { name: 'Test' } },
        },
      });
      expect(result).toBe('Test');
    });
  });

  describe('resolveVariables - filters', () => {
    it('should apply upper filter', () => {
      const result = resolveVariables('{{name | upper}}', { name: 'hello' });
      expect(result).toBe('HELLO');
    });

    it('should apply lower filter', () => {
      const result = resolveVariables('{{name | lower}}', { name: 'HELLO' });
      expect(result).toBe('hello');
    });

    it('should apply trim filter', () => {
      const result = resolveVariables('{{name | trim}}', { name: '  hello  ' });
      expect(result).toBe('hello');
    });

    it('should apply json filter', () => {
      const result = resolveVariables('{{obj | json}}', { obj: { a: 1 } });
      expect(result).toBe('{"a":1}');
    });

    it('should apply length filter to string', () => {
      const result = resolveVariables('{{name | length}}', { name: 'hello' });
      expect(result).toBe('5');
    });

    it('should apply length filter to array', () => {
      const result = resolveVariables('{{arr | length}}', { arr: [1, 2, 3] });
      expect(result).toBe('3');
    });

    it('should apply length filter to object', () => {
      const result = resolveVariables('{{obj | length}}', { obj: { a: 1, b: 2 } });
      expect(result).toBe('2');
    });

    it('should apply truncate filter with default length', () => {
      const longText = 'a'.repeat(100);
      const result = resolveVariables('{{text | truncate}}', { text: longText });
      expect(result).toHaveLength(53);
      expect(result.endsWith('...')).toBe(true);
    });

    it('should apply truncate filter with custom length', () => {
      const result = resolveVariables('{{text | truncate:5}}', { text: 'hello world' });
      expect(result).toBe('hello...');
    });

    it('should not truncate short text', () => {
      const result = resolveVariables('{{text | truncate:20}}', { text: 'hello' });
      expect(result).toBe('hello');
    });

    it('should apply default filter when variable is empty', () => {
      const result = resolveVariables('{{name | default:Guest}}', { name: '' });
      expect(result).toBe('Guest');
    });

    it('should apply default filter when variable is undefined', () => {
      const result = resolveVariables('{{name | default:Guest}}', {});
      expect(result).toBe('Guest');
    });

    it('should not apply default filter when variable has value', () => {
      const result = resolveVariables('{{name | default:Guest}}', { name: 'Alice' });
      expect(result).toBe('Alice');
    });
  });

  describe('resolveVariables - chained pipes', () => {
    it('should apply multiple filters in sequence', () => {
      const result = resolveVariables('{{name | trim | upper}}', { name: '  hello  ' });
      expect(result).toBe('HELLO');
    });

    it('should apply trim, upper, truncate chain', () => {
      const result = resolveVariables('{{text | trim | upper | truncate:5}}', { text: '  hello world  ' });
      expect(result).toBe('HELLO...');
    });

    it('should apply default then upper', () => {
      const result = resolveVariables('{{name | default:guest | upper}}', {});
      expect(result).toBe('GUEST');
    });

    it('should handle three filters with args', () => {
      const result = resolveVariables('{{name | trim | default:hello | upper}}', { name: '  ' });
      expect(result).toBe('HELLO');
    });
  });

  describe('resolveVariables - edge cases', () => {
    it('should handle non-string template gracefully', () => {
      const result = resolveVariables(null as any, { name: 'test' });
      expect(result).toBe('');
    });

    it('should handle undefined variables object', () => {
      const result = resolveVariables('{{name}}', undefined);
      expect(result).toBe('');
    });

    it('should ignore unknown filters', () => {
      const result = resolveVariables('{{name | unknownFilter}}', { name: 'hello' });
      expect(result).toBe('hello');
    });

    it('should handle empty variable name gracefully', () => {
      const result = resolveVariables('{{}}', { name: 'test' });
      expect(result).toBe('{{}}');
    });

    it('should handle variables with special characters in value', () => {
      const result = resolveVariables('{{greeting}}', { greeting: 'hello & <world>' });
      expect(result).toBe('hello & <world>');
    });
  });

  describe('resolveVariableValue', () => {
    it('should return raw value without string conversion', () => {
      const result = resolveVariableValue('count', { count: 42 });
      expect(result).toBe(42);
    });

    it('should return object directly', () => {
      const obj = { a: 1 };
      const result = resolveVariableValue('obj', { obj });
      expect(result).toBe(obj);
    });

    it('should return undefined for missing variable', () => {
      const result = resolveVariableValue('missing', {});
      expect(result).toBeUndefined();
    });

    it('should apply filters to raw value', () => {
      const result = resolveVariableValue('name | upper', { name: 'hello' });
      expect(result).toBe('HELLO');
    });
  });

  describe('getFilters', () => {
    it('should return all builtin filters', () => {
      const filters = getFilters();
      expect(filters).toHaveProperty('upper');
      expect(filters).toHaveProperty('lower');
      expect(filters).toHaveProperty('trim');
      expect(filters).toHaveProperty('json');
      expect(filters).toHaveProperty('length');
      expect(filters).toHaveProperty('truncate');
      expect(filters).toHaveProperty('default');
    });

    it('should return a copy, not the internal reference', () => {
      const filters1 = getFilters();
      const filters2 = getFilters();
      expect(filters1).not.toBe(filters2);
    });
  });

  describe('custom filters', () => {
    it('should support custom extra filters', () => {
      const result = resolveVariables('{{name | reverse}}', { name: 'hello' }, {
        extraFilters: {
          reverse: (v) => (typeof v === 'string' ? v.split('').reverse().join('') : v),
        },
      });
      expect(result).toBe('olleh');
    });

    it('should allow custom filters to be chained with builtin', () => {
      const result = resolveVariables('{{name | upper | reverse}}', { name: 'hello' }, {
        extraFilters: {
          reverse: (v) => (typeof v === 'string' ? v.split('').reverse().join('') : v),
        },
      });
      expect(result).toBe('OLLEH');
    });
  });
});
