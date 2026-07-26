export type FilterFunction = (value: any, arg?: string) => any;

export interface VariableResolverOptions {
  variables?: Record<string, any>;
  nodeOutputs?: Record<string, Record<string, any>>;
  extraFilters?: Record<string, FilterFunction>;
}

const builtinFilters: Record<string, FilterFunction> = {
  upper: (v) => (typeof v === 'string' ? v.toUpperCase() : v),
  lower: (v) => (typeof v === 'string' ? v.toLowerCase() : v),
  trim: (v) => (typeof v === 'string' ? v.trim() : v),
  json: (v) => {
    try {
      return JSON.stringify(v);
    } catch {
      return '';
    }
  },
  length: (v) => {
    if (typeof v === 'string' || Array.isArray(v)) return v.length;
    if (v && typeof v === 'object') return Object.keys(v).length;
    return 0;
  },
  truncate: (v, arg) => {
    const n = arg ? parseInt(arg, 10) : 50;
    if (typeof v !== 'string') return v;
    if (Number.isNaN(n) || n <= 0) return v;
    return v.length > n ? v.slice(0, n) + '...' : v;
  },
  default: (v, arg) => {
    if (v === undefined || v === null || v === '') {
      return arg ?? '';
    }
    return v;
  },
};

function getNestedValue(obj: any, path: string): any {
  if (obj === undefined || obj === null) return undefined;
  const parts = path.split('.');
  let current: any = obj;
  for (const part of parts) {
    if (current === undefined || current === null) return undefined;
    current = current[part];
  }
  return current;
}

function resolveSingleVariable(
  expression: string,
  variables: Record<string, any>,
  nodeOutputs: Record<string, Record<string, any>>,
  filters: Record<string, FilterFunction>
): any {
  const pipeParts = expression.split('|').map((s) => s.trim());
  const varExpr = pipeParts[0];
  const pipeChain = pipeParts.slice(1);

  let value: any;

  if (varExpr.includes('.')) {
    const dotIdx = varExpr.indexOf('.');
    const firstPart = varExpr.slice(0, dotIdx);
    const restPath = varExpr.slice(dotIdx + 1);

    if (nodeOutputs[firstPart] !== undefined) {
      value = getNestedValue(nodeOutputs[firstPart], restPath);
    } else {
      value = getNestedValue(variables[firstPart], restPath);
    }

    if (value === undefined) {
      value = getNestedValue(variables, varExpr);
    }
  } else {
    value = variables[varExpr];
    if (value === undefined && nodeOutputs[varExpr] !== undefined) {
      value = nodeOutputs[varExpr];
    }
  }

  for (const pipe of pipeChain) {
    const colonIdx = pipe.indexOf(':');
    let filterName: string;
    let filterArg: string | undefined;
    if (colonIdx >= 0) {
      filterName = pipe.slice(0, colonIdx).trim();
      filterArg = pipe.slice(colonIdx + 1).trim();
    } else {
      filterName = pipe.trim();
      filterArg = undefined;
    }
    const filterFn = filters[filterName];
    if (filterFn) {
      value = filterFn(value, filterArg);
    }
  }

  return value;
}

export function resolveVariables(
  template: string,
  variables: Record<string, any> = {},
  options: Omit<VariableResolverOptions, 'variables'> = {}
): string {
  if (!template || typeof template !== 'string') return '';

  const { nodeOutputs = {}, extraFilters = {} } = options;
  const allFilters = { ...builtinFilters, ...extraFilters };

  const pattern = /\{\{\s*([^{}]+?)\s*\}\}/g;

  return template.replace(pattern, (_match, expression: string) => {
    try {
      const value = resolveSingleVariable(expression, variables, nodeOutputs, allFilters);
      if (value === undefined || value === null) return '';
      if (typeof value === 'object') {
        try {
          return JSON.stringify(value);
        } catch {
          return '';
        }
      }
      return String(value);
    } catch {
      return '';
    }
  });
}

export function resolveVariableValue(
  expression: string,
  variables: Record<string, any> = {},
  options: Omit<VariableResolverOptions, 'variables'> = {}
): any {
  const { nodeOutputs = {}, extraFilters = {} } = options;
  const allFilters = { ...builtinFilters, ...extraFilters };
  try {
    return resolveSingleVariable(expression, variables, nodeOutputs, allFilters);
  } catch {
    return undefined;
  }
}

export function getFilters(): Record<string, FilterFunction> {
  return { ...builtinFilters };
}
