import { homedir } from "node:os";
import { join } from "node:path";
export function resolveCacheRoot(options = {}) {
    const env = options.env ?? process.env;
    const home = options.homeDir ?? homedir();
    if (env.PI_FZF_CACHE_DIR)
        return env.PI_FZF_CACHE_DIR;
    if (env.XDG_CACHE_HOME)
        return join(env.XDG_CACHE_HOME, "pi-fzf");
    return join(home, ".cache", "pi-fzf");
}
export function resolveSessionRoot(options = {}) {
    const env = options.env ?? process.env;
    const home = options.homeDir ?? homedir();
    if (env.PI_FZF_SESSION_ROOT)
        return env.PI_FZF_SESSION_ROOT;
    return join(home, ".pi", "agent", "sessions");
}
//# sourceMappingURL=paths.js.map