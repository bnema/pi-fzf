const HELP = `pi-fzf

Search previous Pi sessions with rg and fzf.

Usage:
  pi-fzf --help
  pi-fzf help

Commands will be implemented in later phases.
`;

export async function main(args: string[] = process.argv.slice(2)): Promise<void> {
  if (args.length === 0 || args.includes("--help") || args.includes("-h") || args[0] === "help") {
    console.log(HELP.trimEnd());
    return;
  }

  console.error("pi-fzf: session search commands are not implemented yet");
  process.exitCode = 1;
}
