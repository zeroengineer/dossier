import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

/** Absolute path of the repository root (the directory holding package.json). */
export const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url)).replace(/\/$/, '');
/** Shipped assets: OFL fonts and generated placeholders. */
export const ASSETS_DIR = join(REPO_ROOT, 'assets');
export const FONTS_DIR = join(ASSETS_DIR, 'fonts');
export const PLACEHOLDERS_DIR = join(ASSETS_DIR, 'placeholders');
/** The fake example workspace copied by `dossier init`. */
export const EXAMPLE_WORKSPACE = join(REPO_ROOT, 'workspace.example');
