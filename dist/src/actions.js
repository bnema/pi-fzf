import { spawn } from "node:child_process";
export async function runSelectedAction(record, action, options = {}) {
    switch (action) {
        case "print-session-id":
            console.log(record.sessionId);
            return true;
        case "print-session-path":
            console.log(record.sessionPath);
            return true;
        case "print-snippet":
            console.log(record.text);
            return true;
        case "json":
            console.log(JSON.stringify(record));
            return true;
        case "copy": return copyText(options.clipboardText ?? record.text);
        case "resume": return outputOrExec(buildResumeCommand(record), buildResumeArgv(record), options.exec, record.cwd);
        case "fork": return outputOrExec(buildForkCommand(record), buildForkArgv(record), options.exec, record.cwd);
        case "menu":
            console.log(record.text);
            return true;
    }
}
export function buildResumeCommand(record) {
    return `${cdPrefix(record.cwd)}pi --session ${shellQuote(record.sessionPath)}`;
}
export function buildForkCommand(record) {
    return `${cdPrefix(record.cwd)}pi --fork ${shellQuote(record.sessionPath)}`;
}
export function buildResumeArgv(record) {
    return ["pi", "--session", record.sessionPath];
}
export function buildForkArgv(record) {
    return ["pi", "--fork", record.sessionPath];
}
export async function copyText(text) {
    for (const cmd of ["wl-copy", "xclip", "xsel", "pbcopy"]) {
        const args = cmd === "xclip" ? ["-selection", "clipboard"] : cmd === "xsel" ? ["--clipboard", "--input"] : [];
        if (await pipe(cmd, args, text))
            return true;
    }
    console.log(text);
    return false;
}
async function outputOrExec(command, argv, exec, cwd) {
    if (!exec) {
        console.log(command);
        return true;
    }
    const [cmd, ...args] = argv;
    return new Promise((resolve) => {
        const child = spawn(cmd, args, { stdio: "inherit", shell: false, cwd });
        child.on("error", () => resolve(false));
        child.on("close", (code) => resolve(code === 0));
    });
}
async function pipe(command, args, input) {
    return new Promise((resolve) => {
        const child = spawn(command, args, { shell: false, stdio: ["pipe", "ignore", "ignore"] });
        child.on("error", () => resolve(false));
        child.on("close", (code) => resolve(code === 0));
        child.stdin.end(input);
    });
}
function cdPrefix(cwd) { return cwd ? `cd ${shellQuote(cwd)} && ` : ""; }
function shellQuote(value) { return `'${value.replaceAll("'", `'\\''`)}'`; }
//# sourceMappingURL=actions.js.map