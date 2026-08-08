// Renders the placeholders in a Classification.cliInvocation (guessed by
// Claude from the README's Quick Start, see claude-client.ts) against a
// concrete fixture file, for the capability tier.

export function renderCliCommand(template: string, vars: { input: string; output: string }): string {
  return template.replaceAll("{input}", vars.input).replaceAll("{output}", vars.output);
}

export function renderOutputPath(template: string, inputFile: string): string {
  const basename = basenameWithoutExt(inputFile);
  return template.replaceAll("{basename}", basename).replaceAll("{input}", inputFile);
}

function basenameWithoutExt(fileName: string): string {
  return fileName.replace(/\.[^./]+$/, "");
}
