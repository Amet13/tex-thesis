import { randomUUID } from 'node:crypto';

/** Escapes a workflow-command message (`::error::<data>`). */
export const escapeData = (s: string) =>
  s.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');

/**
 * A `$GITHUB_OUTPUT` record with a random heredoc delimiter, so a value cannot
 * end the record early and inject other outputs.
 */
export function outputRecord(
  name: string,
  value: string,
  delimiter = `ghadelimiter_${randomUUID()}`,
): string {
  if (value.includes(delimiter)) throw new Error(`Output ${name} contains its delimiter`);
  return `${name}<<${delimiter}\n${value}\n${delimiter}\n`;
}
