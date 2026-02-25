/**
 * Interpolates {{param}} and {{param | "default"}} expressions in a markdown template.
 *
 * Syntax:
 *   {{paramName}}              — required parameter substitution
 *   {{paramName | "default"}}  — optional parameter with fallback value
 *
 * If a required parameter is missing and no default is given, the placeholder
 * is left as-is (the LLM will receive the literal {{paramName}}).
 */
export function interpolate(
  template: string,
  params: Record<string, unknown>
): string {
  return template.replace(
    /\{\{(\w+)(?:\s*\|\s*"([^"]*)")?\}\}/g,
    (_match, paramName: string, defaultValue: string | undefined) => {
      const value = params[paramName];

      if (value !== undefined && value !== null) {
        return String(value);
      }

      if (defaultValue !== undefined) {
        return defaultValue;
      }

      // Leave the placeholder in place for visibility
      return `{{${paramName}}}`;
    }
  );
}

/**
 * Validates that all required parameters are present in the provided args.
 * Returns an array of missing required parameter names.
 */
export function validateParams(
  template: string,
  params: Record<string, unknown>,
  requiredParams: Set<string>
): string[] {
  const missing: string[] = [];

  for (const required of requiredParams) {
    if (params[required] === undefined || params[required] === null) {
      missing.push(required);
    }
  }

  return missing;
}
