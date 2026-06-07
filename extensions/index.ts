import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function piFzfExtension(pi: ExtensionAPI): void {
  pi.registerCommand("fzf", {
    description: "Search previous Pi sessions with pi-fzf (not implemented yet).",
    async handler(_args, ctx) {
      await ctx.waitForIdle();
      pi.sendMessage({
        customType: "pi-fzf.info",
        content: "pi-fzf session search is not implemented yet.",
        display: true
      });
    }
  });
}
