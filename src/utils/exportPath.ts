import { constants } from "fs";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";

export function exportBaseDir(): string {
    return process.env.MCP_EXPORT_DIR || path.join(os.homedir(), "Downloads", "opengraph-mcp");
}

type Resolved = { ok: true; path: string } | { ok: false; error: string };

export type ExportFormat = "PNG" | "JPEG" | "WEBP" | "SVG";

const EXTENSIONS: Record<ExportFormat, string[]> = {
    PNG:  [".png"],
    JPEG: [".jpg", ".jpeg"],
    WEBP: [".webp"],
    SVG:  [".svg"],
};

function inside(base: string, candidate: string): boolean {
    const rel = path.relative(base, candidate);
    // A prefix compare would let /base match /baseball.
    return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
}

const atOrInside = (base: string, candidate: string): boolean => candidate === base || inside(base, candidate);

async function realpathOfExistingAncestor(p: string): Promise<string> {
    let current = p;
    for (;;) {
        try {
            return await fs.realpath(current);
        } catch {
            const parent = path.dirname(current);
            if (parent === current) throw new Error("No existing ancestor");
            current = parent;
        }
    }
}

/**
 * Where an export may be written: always inside one base folder. The model
 * chooses the path, so a page's injected text could otherwise aim the write at
 * ~/.ssh or a shell profile. Symlinks are resolved before anything is created,
 * because mkdir and open both follow them.
 */
export async function resolveExportPath(requested: string, format: ExportFormat): Promise<Resolved> {
    if (!requested || requested.includes("\0")) {
        return { ok: false, error: "Invalid destination path." };
    }
    // The extension must match the bytes, so an export can never land as a script,
    // a page, or a source file the user later runs.
    const ext = path.extname(requested).toLowerCase();
    if (ext && !EXTENSIONS[format].includes(ext)) {
        return { ok: false, error: `A ${format} image must be saved as ${EXTENSIONS[format].join(" or ")}.` };
    }
    if (!ext) requested = `${requested}${EXTENSIONS[format][0]}`;
    const baseRaw = path.resolve(exportBaseDir());

    let base: string;
    try {
        await fs.mkdir(baseRaw, { recursive: true });
        base = await fs.realpath(baseRaw);
    } catch {
        return { ok: false, error: `Saving to disk is unavailable: cannot use the export folder ${baseRaw}.` };
    }

    let rel = path.normalize(requested);
    if (path.isAbsolute(requested)) {
        // Accept either spelling of the folder (macOS /var is /private/var, for one).
        const viaRaw = path.relative(baseRaw, path.resolve(requested));
        rel = viaRaw.startsWith("..") ? path.relative(base, path.resolve(requested)) : viaRaw;
    }
    const target = path.join(base, rel);
    if (path.isAbsolute(rel) || !inside(base, target)) {
        return { ok: false, error: `Destination must be inside the export folder ${baseRaw}.` };
    }
    // Hidden folders and files (.git/hooks, .bashrc) are where a write does damage,
    // and an image never needs to live in one. Checked below the folder only, so a
    // folder that is itself under a dot directory still works.
    if (rel.split(path.sep).some((part) => part.startsWith("."))) {
        return { ok: false, error: "Destination may not include hidden files or folders." };
    }

    const parent = path.dirname(target);
    if (!atOrInside(base, await realpathOfExistingAncestor(parent))) {
        return { ok: false, error: "Destination leaves the export folder through a symlink." };
    }
    let realParent: string;
    try {
        await fs.mkdir(parent, { recursive: true });
        realParent = await fs.realpath(parent);
    } catch {
        return { ok: false, error: "Could not create the destination folder." };
    }
    if (!atOrInside(base, realParent)) {
        return { ok: false, error: "Destination leaves the export folder through a symlink." };
    }
    return { ok: true, path: path.join(realParent, path.basename(target)) };
}

/**
 * Never follows a symlink at the final component, which a parent check cannot
 * see, and never truncates before checking what was opened: a hard link inside
 * the folder can point at a file outside it, and the path can be swapped between
 * the check and the open.
 */
export async function writeExport(target: string, data: Buffer): Promise<void> {
    const flags = constants.O_WRONLY | constants.O_CREAT | (constants.O_NOFOLLOW ?? 0);
    const handle = await fs.open(target, flags, 0o644);
    try {
        const opened = await handle.stat();
        const atPath = await fs.lstat(target);
        if (!opened.isFile() || opened.nlink > 1 || opened.ino !== atPath.ino || opened.dev !== atPath.dev) {
            throw new Error("Refusing to overwrite a file that is linked from elsewhere.");
        }
        await handle.truncate(0);
        await handle.writeFile(data);
    } finally {
        await handle.close();
    }
}
