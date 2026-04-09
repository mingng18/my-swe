import { parse as parseYaml } from "yaml";

export function parseYamlFrontmatter(yaml: string): Record<string, unknown> {
  try {
    const result = parseYaml(yaml) as Record<string, unknown> | null;
    return result || {};
  } catch (err) {
    const fixed = fixCommonYamlIssues(yaml);
    const result = parseYaml(fixed) as Record<string, unknown> | null;
    return result || {};
  }
}

function fixCommonYamlIssues(yaml: string): string {
  return yaml
    .split("\n")
    .map((line) => {
      const match = line.match(/^(\w+):\s*(.+?:.*)$/);
      if (match && !match[2].startsWith('"')) {
        return `${match[1]}: ${JSON.stringify(match[2])}`;
      }
      return line;
    })
    .join("\n");
}

export function stripFrontmatter(content: string): string {
  const match = content.match(/^---\n(.*?)\n---/s);
  if (!match) return content;
  return content.slice(match[0].length).trim();
}
